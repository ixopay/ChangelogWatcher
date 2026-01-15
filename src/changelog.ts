import { ReleaseSource } from "./config";
import { readStoredData, writeStoredData } from "./hash-store";
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
  version: string;
  formattedChanges: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

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

function createGenericUpdate(source: ReleaseSource, date?: string): {
  version: string;
  formattedChanges: string;
} {
  const version = date ? `Updated ${date}` : "Update detected";
  return {
    version,
    formattedChanges: `${source.name} release notes have been updated.\n\nCheck the latest changes here:\n${source.releasePageUrl}`,
  };
}

// Extract date from Gemini page (format: YYYY.MM.DD)
function extractGeminiDate(html: string): string | null {
  const match = html.match(/\d{4}\.\d{2}\.\d{2}/);
  return match ? match[0] : null;
}

// Extract date from ChatGPT page (format: "January 12, 2026")
function extractChatGPTDate(html: string): string | null {
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const regex = new RegExp(`(${months})\\s+\\d{1,2},\\s+20\\d{2}`);
  const match = html.match(regex);
  return match ? match[0] : null;
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

interface ParserResult {
  success: boolean;
  version?: string;
  content?: ParsedContent;
  error?: string;
}

async function parseMarkdown(source: ReleaseSource): Promise<ParserResult> {
  const content = await fetchContent(source.url);
  if (!content) {
    return { success: false, error: "Failed to fetch Claude Code changelog" };
  }

  const { version, changes } = extractMarkdownVersion(content);

  return {
    success: true,
    version,
    content: {
      version,
      formattedChanges: changes,
    },
  };
}

async function parseGemini(source: ReleaseSource): Promise<ParserResult> {
  const content = await fetchContent(source.url);
  if (!content) {
    return { success: false, error: "Failed to fetch Gemini page" };
  }

  const date = extractGeminiDate(content);
  if (!date) {
    return { success: false, error: "Could not extract date from Gemini page" };
  }

  const { version, formattedChanges } = createGenericUpdate(source, date);

  return {
    success: true,
    version: date, // Use date as the comparison key
    content: {
      version,
      formattedChanges,
    },
  };
}

async function parseChatGPT(source: ReleaseSource): Promise<ParserResult> {
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

  const html = await contentResponse.text();
  const date = extractChatGPTDate(html);

  if (!date) {
    // Fall back to generic update if date extraction fails
    log.warn("  Could not extract date, using snapshot timestamp");
  }

  const comparisonKey = date || snapshot.timestamp;
  const { version, formattedChanges } = createGenericUpdate(source, date || undefined);

  return {
    success: true,
    version: comparisonKey, // Use date or fallback to timestamp
    content: {
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
    let result: ParserResult;
    let isTransient = false;

    switch (source.parserType) {
      case "markdown":
        result = await parseMarkdown(source);
        break;

      case "hash-only":
        result = await parseGemini(source);
        break;

      case "wayback":
        result = await parseChatGPT(source);
        isTransient = true; // Wayback failures are transient
        break;

      default:
        return { source, hasChanged: false, error: "Unknown parser type" };
    }

    if (!result.success) {
      return {
        source,
        hasChanged: false,
        error: result.error,
        isTransient,
      };
    }

    // Compare version/date with stored value
    const storedData = readStoredData(source);
    const storedVersion = storedData?.version;

    if (storedVersion === result.version) {
      return { source, hasChanged: false };
    }

    // Change detected - save new version
    writeStoredData(source, { version: result.version });

    return {
      source,
      hasChanged: true,
      version: result.content!.version,
      formattedChanges: result.content!.formattedChanges,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { source, hasChanged: false, error: errorMsg };
  }
}
