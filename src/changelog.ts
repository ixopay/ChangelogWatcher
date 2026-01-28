import { ReleaseSource } from "./config";
import { readStoredData, writeStoredData } from "./hash-store";
import * as log from "./logger";
import semver from "semver";

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

export interface VersionEntry {
  version: string;
  changes: string;
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

// Extract ALL versions from a markdown changelog (newest first)
export function extractAllVersions(content: string): VersionEntry[] {
  const lines = content.split("\n");
  const versions: VersionEntry[] = [];
  let currentVersion: string | null = null;
  let currentChanges: string[] = [];

  for (const line of lines) {
    const versionMatch = line.match(/^#+\s*\[?(\d+\.\d+\.\d+[^\]]*)\]?/);

    if (versionMatch) {
      // Save previous version if exists
      if (currentVersion !== null) {
        versions.push({
          version: currentVersion,
          changes: currentChanges.join("\n").trim(),
        });
      }
      // Start new version
      currentVersion = versionMatch[1];
      currentChanges = [line];
    } else if (currentVersion !== null) {
      currentChanges.push(line);
    }
  }

  // Don't forget the last version
  if (currentVersion !== null) {
    versions.push({
      version: currentVersion,
      changes: currentChanges.join("\n").trim(),
    });
  }

  return versions;
}

// Compare semantic versions: returns 1 if a > b, -1 if a < b, 0 if equal
// Uses semver library for proper handling of pre-release versions
export function compareVersions(a: string, b: string): number {
  // Clean versions to handle any extra characters
  const cleanA = semver.clean(a) || semver.coerce(a)?.version;
  const cleanB = semver.clean(b) || semver.coerce(b)?.version;

  if (!cleanA || !cleanB) {
    // Fallback to string comparison if semver can't parse
    return a.localeCompare(b);
  }

  return semver.compare(cleanA, cleanB);
}

// Check if newId is newer than oldId based on parser type
// Used to prevent regression to older versions/dates
export function isNewerIdentifier(
  newId: string,
  oldId: string,
  parserType: "markdown" | "wayback"
): boolean {
  if (parserType === "markdown") {
    // Use semver comparison for Claude versions
    return compareVersions(newId, oldId) > 0;
  } else {
    // Wayback uses YYYY.MM.DD format - lexicographic comparison works
    return newId > oldId;
  }
}

// Filter versions to only those newer than lastKnownVersion
export function getVersionsSince(
  allVersions: VersionEntry[],
  lastKnownVersion: string | null
): VersionEntry[] {
  if (!lastKnownVersion) {
    // First run: return only the latest version
    return allVersions.slice(0, 1);
  }

  // Filter to versions newer than lastKnownVersion
  return allVersions.filter(
    (v) => compareVersions(v.version, lastKnownVersion) > 0
  );
}

// Extract date from Gemini page (format: YYYY.MM.DD)
export function extractGeminiDate(html: string): string | null {
  const match = html.match(/\d{4}\.\d{2}\.\d{2}/);
  return match ? match[0] : null;
}

// Extract date from ChatGPT page (format: "January 12, 2026")
export function extractChatGPTDate(html: string): string | null {
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const regex = new RegExp(`(${months})\\s+\\d{1,2},\\s+20\\d{2}`);
  const match = html.match(regex);
  return match ? match[0] : null;
}

// Strip HTML tags and normalize whitespace
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract changes for a specific date from Gemini page
// Format: "2025.12.17\nTitle\nWhat: ...\nWhy: ...\n2025.12.16..."
export function extractGeminiChanges(
  html: string,
  targetDate: string
): string | null {
  const text = stripHtml(html);

  // Find the target date and extract content until the next date
  const datePattern = /\d{4}\.\d{2}\.\d{2}/g;
  const dates: { date: string; index: number }[] = [];

  let match;
  while ((match = datePattern.exec(text)) !== null) {
    dates.push({ date: match[0], index: match.index });
  }

  // Find the target date's position
  const targetIndex = dates.findIndex((d) => d.date === targetDate);
  if (targetIndex === -1) return null;

  const startPos = dates[targetIndex].index;
  const endPos =
    targetIndex + 1 < dates.length ? dates[targetIndex + 1].index : text.length;

  const content = text.slice(startPos, endPos).trim();

  // Clean up: remove the date prefix and format nicely
  const withoutDate = content.replace(targetDate, "").trim();
  return withoutDate || null;
}

// Extract changes for a specific date from ChatGPT page
// Format: "January 15, 2026\nTitle\nContent...\nJanuary 12, 2026..."
export function extractChatGPTChanges(
  html: string,
  targetDate: string
): string | null {
  const text = stripHtml(html);

  // Pattern to match dates like "January 15, 2026"
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const datePattern = new RegExp(`(${months})\\s+\\d{1,2},\\s+20\\d{2}`, "g");

  const dates: { date: string; index: number }[] = [];
  let match;
  while ((match = datePattern.exec(text)) !== null) {
    dates.push({ date: match[0], index: match.index });
  }

  // Find the target date's position
  const targetIndex = dates.findIndex((d) => d.date === targetDate);
  if (targetIndex === -1) return null;

  const startPos = dates[targetIndex].index;
  const endPos =
    targetIndex + 1 < dates.length ? dates[targetIndex + 1].index : text.length;

  const content = text.slice(startPos, endPos).trim();

  // Clean up: remove the date prefix
  const withoutDate = content.replace(targetDate, "").trim();
  return withoutDate || null;
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

async function parseMarkdown(
  source: ReleaseSource,
  storedVersion: string | null
): Promise<ParserResult> {
  const content = await fetchContent(source.url);
  if (!content) {
    return { success: false, error: "Failed to fetch Claude Code changelog" };
  }

  const allVersions = extractAllVersions(content);
  if (allVersions.length === 0) {
    return { success: false, error: "No versions found in changelog" };
  }

  const missedVersions = getVersionsSince(allVersions, storedVersion);

  if (missedVersions.length === 0) {
    // No new versions - return current latest for comparison
    return {
      success: true,
      version: allVersions[0].version,
      content: {
        version: allVersions[0].version,
        formattedChanges: allVersions[0].changes,
      },
    };
  }

  // Combine all missed version changelogs (oldest first for chronological reading)
  const reversedMissed = [...missedVersions].reverse();
  const combinedChanges = reversedMissed.map((v) => v.changes).join("\n\n---\n\n");

  // Version display: show range if multiple, single if one
  const versionDisplay =
    missedVersions.length === 1
      ? missedVersions[0].version
      : `${reversedMissed[0].version} → ${missedVersions[0].version}`;

  return {
    success: true,
    version: missedVersions[0].version, // Store the newest
    content: {
      version: versionDisplay,
      formattedChanges: combinedChanges,
    },
  };
}

// Fetch the newest Wayback snapshot using CDX API (deterministic, unlike /available)
async function fetchNewestWaybackSnapshot(
  targetUrl: string
): Promise<{ timestamp: string; originalUrl: string } | null> {
  // CDX API: get newest snapshot sorted by timestamp descending
  const cdxUrl = new URL("https://web.archive.org/cdx/search/cdx");
  cdxUrl.searchParams.set("url", targetUrl);
  cdxUrl.searchParams.set("output", "json");
  cdxUrl.searchParams.set("limit", "1");
  cdxUrl.searchParams.set("fl", "timestamp,original");
  cdxUrl.searchParams.set("filter", "statuscode:200");
  cdxUrl.searchParams.set("sort", "reverse"); // Newest first

  const response = await fetchWithRetry(cdxUrl.toString());
  if (!response) {
    return null;
  }

  let data: string[][];
  try {
    data = await response.json();
  } catch {
    return null;
  }

  // CDX returns: [["timestamp","original"], ["20260115123456","https://..."]]
  // First row is headers, second row is data
  if (!Array.isArray(data) || data.length < 2) {
    return null;
  }

  const [timestamp, originalUrl] = data[1];
  if (!timestamp || !originalUrl) {
    return null;
  }

  return { timestamp, originalUrl };
}

async function parseWayback(source: ReleaseSource): Promise<ParserResult> {
  // Use CDX API to get the newest snapshot (deterministic, unlike /available)
  const snapshot = await fetchNewestWaybackSnapshot(source.url);

  if (!snapshot) {
    return { success: false, error: "No Wayback snapshot available via CDX" };
  }

  log.info(`  Found Wayback snapshot from ${snapshot.timestamp}`);

  // Build snapshot URL: https://web.archive.org/web/{timestamp}/{original_url}
  const snapshotUrl = `https://web.archive.org/web/${snapshot.timestamp}/${snapshot.originalUrl}`;

  // Fetch archived content with retry
  const contentResponse = await fetchWithRetry(snapshotUrl, {
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

  // Extract date based on source type
  const date =
    source.id === "gemini" ? extractGeminiDate(html) : extractChatGPTDate(html);

  if (!date) {
    // Fall back to generic update if date extraction fails
    log.warn("  Could not extract date, using snapshot timestamp");
  }

  const comparisonKey = date || snapshot.timestamp;

  // Extract actual changes for this date based on source type
  const changes = date
    ? source.id === "gemini"
      ? extractGeminiChanges(html, date)
      : extractChatGPTChanges(html, date)
    : null;

  const formattedChanges = changes
    ? `${source.name} (${date})\n\n${changes}\n\n${source.releasePageUrl}`
    : `${source.name} release notes updated${date ? ` on ${date}` : ""}.\n\n${source.releasePageUrl}`;

  return {
    success: true,
    version: comparisonKey, // Use date or fallback to timestamp
    content: {
      version: date ? `Updated ${date}` : "Update detected",
      formattedChanges,
    },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

export async function checkSource(source: ReleaseSource): Promise<CheckResult> {
  try {
    // Get stored data first (needed for markdown multi-version detection)
    const storedData = readStoredData(source);
    const storedVersion = storedData?.identifier || null;

    // Parse content based on type
    let result: ParserResult;
    let isTransient = false;

    switch (source.parserType) {
      case "markdown":
        // Pass stored version so parseMarkdown can detect ALL missed versions
        result = await parseMarkdown(source, storedVersion);
        break;

      case "wayback":
        result = await parseWayback(source);
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
    if (storedVersion === result.version) {
      return { source, hasChanged: false };
    }

    // Prevent regression: only update if new version is actually newer
    if (
      storedVersion &&
      result.version &&
      !isNewerIdentifier(result.version, storedVersion, source.parserType)
    ) {
      log.warn(
        `  Extracted ${result.version} is not newer than stored ${storedVersion}, skipping`
      );
      return { source, hasChanged: false };
    }

    // Change detected - save new identifier
    writeStoredData(source, { identifier: result.version });

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
