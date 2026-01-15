import { createHash } from "crypto";
import * as cheerio from "cheerio";
import { ReleaseSource } from "./config";
import { readHash, writeHash } from "./hash-store";
import * as log from "./logger";

export interface CheckResult {
  source: ReleaseSource;
  hasChanged: boolean;
  version?: string;
  formattedChanges?: string;
  error?: string;
  isTransient?: boolean; // True for retryable/non-critical failures (e.g., Wayback down)
}

interface ParsedContent {
  stableContent: string;
  version: string;
  formattedChanges: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractStableContent(html: string, sourceId: string): string {
  const $ = cheerio.load(html);

  $("script").remove();
  $("style").remove();
  $("link").remove();
  $("meta").remove();
  $("noscript").remove();
  $("iframe").remove();

  if (sourceId === "gemini") {
    const mainContent =
      $("main").text() || $("article").text() || $("body").text();
    return mainContent.replace(/\s+/g, " ").trim();
  }

  return $("body").text().replace(/\s+/g, " ").trim();
}

async function fetchContent(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  return response.ok ? response.text() : null;
}

function extractMarkdownVersion(content: string): {
  version: string;
  changes: string;
} {
  const lines = content.split("\n");
  let latestVersionInfo = "";
  let version = "";
  let foundFirstVersion = false;

  for (const line of lines) {
    const versionMatch = line.match(/^#+\s*\[?(\d+\.\d+\.\d+[^\]]*)\]?/);

    if (versionMatch) {
      if (!foundFirstVersion) {
        foundFirstVersion = true;
        version = versionMatch[1];
        latestVersionInfo += line + "\n";
      } else {
        break; // Found second version, stop
      }
    } else if (foundFirstVersion) {
      latestVersionInfo += line + "\n";
    }
  }

  return {
    version: version || "Unknown",
    changes: latestVersionInfo.trim() || content.substring(0, 1000),
  };
}

function createGenericUpdate(source: ReleaseSource): {
  version: string;
  formattedChanges: string;
} {
  return {
    version: "Update detected",
    formattedChanges: `${source.name} release notes have been updated.\n\nCheck the latest changes here:\n${source.releasePageUrl}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2,
  delayMs = 2000
): Promise<Response | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (attempt < retries) {
        log.warn(`  Retry ${attempt}/${retries - 1} after ${response.status}...`);
        await sleep(delayMs);
      }
    } catch {
      if (attempt < retries) {
        log.warn(`  Retry ${attempt}/${retries - 1} after network error...`);
        await sleep(delayMs);
      }
    }
  }
  return null;
}

// =============================================================================
// Parser Functions - Each handles fetch + parse for its type
// =============================================================================

async function parseMarkdown(
  source: ReleaseSource
): Promise<ParsedContent | null> {
  const content = await fetchContent(source.url);
  if (!content) return null;

  const { version, changes } = extractMarkdownVersion(content);

  return {
    stableContent: content,
    version,
    formattedChanges: changes,
  };
}

async function parseHashOnly(
  source: ReleaseSource
): Promise<ParsedContent | null> {
  const content = await fetchContent(source.url);
  if (!content) return null;

  const { version, formattedChanges } = createGenericUpdate(source);

  return {
    stableContent: extractStableContent(content, source.id),
    version,
    formattedChanges,
  };
}

interface WaybackResult {
  success: boolean;
  content?: ParsedContent;
  error?: string;
}

async function parseWayback(source: ReleaseSource): Promise<WaybackResult> {
  // Check Wayback Machine availability with retry
  const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(source.url)}`;
  const availabilityResponse = await fetchWithRetry(availabilityUrl);

  if (!availabilityResponse) {
    return { success: false, error: "Wayback Machine API unavailable" };
  }

  let availability;
  try {
    availability = await availabilityResponse.json();
  } catch {
    return { success: false, error: "Invalid response from Wayback Machine" };
  }

  const snapshot = availability.archived_snapshots?.closest;

  if (!snapshot?.available) {
    return { success: false, error: "No Wayback snapshot available" };
  }

  log.info(`  Found Wayback snapshot from ${snapshot.timestamp}`);

  // Fetch archived content with retry
  const contentResponse = await fetchWithRetry(snapshot.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!contentResponse) {
    return { success: false, error: "Failed to fetch Wayback content" };
  }

  const content = await contentResponse.text();
  const { version, formattedChanges } = createGenericUpdate(source);

  return {
    success: true,
    content: {
      stableContent: extractStableContent(content, source.id),
      version,
      formattedChanges,
    },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

export async function checkSource(source: ReleaseSource): Promise<CheckResult> {
  try {
    // Parse content based on type
    let parsed: ParsedContent | null = null;

    switch (source.parserType) {
      case "markdown":
        parsed = await parseMarkdown(source);
        break;
      case "hash-only":
        parsed = await parseHashOnly(source);
        break;
      case "wayback": {
        const waybackResult = await parseWayback(source);
        if (!waybackResult.success) {
          // Wayback failures are transient - don't fail the workflow
          return {
            source,
            hasChanged: false,
            error: waybackResult.error,
            isTransient: true,
          };
        }
        parsed = waybackResult.content!;
        break;
      }
      default:
        return { source, hasChanged: false, error: `Unknown parser type` };
    }

    if (!parsed) {
      return { source, hasChanged: false, error: "Failed to fetch content" };
    }

    // Compare hashes
    const newHash = computeHash(parsed.stableContent);
    const oldHash = readHash(source);

    if (oldHash === newHash) {
      return { source, hasChanged: false };
    }

    // Change detected
    writeHash(source, newHash);

    return {
      source,
      hasChanged: true,
      version: parsed.version,
      formattedChanges: parsed.formattedChanges,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { source, hasChanged: false, error: errorMsg };
  }
}
