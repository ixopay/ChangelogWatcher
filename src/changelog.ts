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
}

// Compute SHA256 hash
export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Extract stable content from HTML (removes scripts, styles, etc.)
export function extractStableContent(html: string, sourceId: string): string {
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

  const bodyText = $("body").text();
  return bodyText.replace(/\s+/g, " ").trim();
}

// Fetch content directly
async function fetchDirectContent(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

// Fetch content via Wayback Machine
async function fetchWaybackContent(
  url: string
): Promise<{ content: string; timestamp: string } | null> {
  const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const availabilityResponse = await fetch(availabilityUrl);

  if (!availabilityResponse.ok) {
    return null;
  }

  const availability = await availabilityResponse.json();

  if (!availability.archived_snapshots?.closest?.available) {
    return null;
  }

  const snapshot = availability.archived_snapshots.closest;
  log.info(`  Found Wayback snapshot from ${snapshot.timestamp}`);

  const contentResponse = await fetch(snapshot.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!contentResponse.ok) {
    return null;
  }

  return { content: await contentResponse.text(), timestamp: snapshot.timestamp };
}

// Parse version from markdown changelog
function parseMarkdownVersion(content: string): {
  version: string;
  changes: string;
} {
  const lines = content.split("\n");
  let latestVersionInfo = "";
  let version = "";
  let foundFirstVersion = false;
  let foundSecondVersion = false;

  for (const line of lines) {
    const versionMatch = line.match(/^#+\s*\[?(\d+\.\d+\.\d+[^\]]*)\]?/);

    if (versionMatch) {
      if (!foundFirstVersion) {
        foundFirstVersion = true;
        version = versionMatch[1];
        latestVersionInfo += line + "\n";
      } else {
        foundSecondVersion = true;
        break;
      }
    } else if (foundFirstVersion && !foundSecondVersion) {
      latestVersionInfo += line + "\n";
    }
  }

  return {
    version: version || "Unknown",
    changes: latestVersionInfo.trim() || content.substring(0, 1000),
  };
}

// Main function to check a source for changes
export async function checkSource(source: ReleaseSource): Promise<CheckResult> {
  try {
    let content: string | null = null;
    let stableContent: string;

    // Fetch content based on parser type
    if (source.parserType === "wayback") {
      const waybackResult = await fetchWaybackContent(source.url);
      if (!waybackResult) {
        log.warn(`  Wayback Machine unavailable for ${source.name}`);
        return {
          source,
          hasChanged: false,
          error: "Wayback Machine unavailable",
        };
      }
      content = waybackResult.content;
      stableContent = extractStableContent(content, source.id);
    } else if (source.parserType === "hash-only") {
      content = await fetchDirectContent(source.url);
      if (!content) {
        return { source, hasChanged: false, error: "Failed to fetch content" };
      }
      stableContent = extractStableContent(content, source.id);
    } else {
      // markdown
      content = await fetchDirectContent(source.url);
      if (!content) {
        return { source, hasChanged: false, error: "Failed to fetch content" };
      }
      stableContent = content; // Use raw content for markdown
    }

    // Compute hash and compare
    const newHash = computeHash(stableContent);
    const oldHash = readHash(source);

    if (oldHash === newHash) {
      return { source, hasChanged: false };
    }

    // Change detected - save new hash and extract version info
    writeHash(source, newHash);

    let version: string;
    let formattedChanges: string;

    if (source.parserType === "markdown") {
      const parsed = parseMarkdownVersion(content);
      version = parsed.version;
      formattedChanges = parsed.changes;
    } else {
      version = "Update detected";
      formattedChanges = `${source.name} release notes have been updated.\n\nCheck the latest changes here:\n${source.releasePageUrl}`;
    }

    return {
      source,
      hasChanged: true,
      version,
      formattedChanges,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { source, hasChanged: false, error: errorMsg };
  }
}
