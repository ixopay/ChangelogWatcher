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
    // Try parsing as human-readable dates first (e.g., "January 12, 2026")
    const newDate = parseMonthDayYearDate(newId);
    const oldDate = parseMonthDayYearDate(oldId);
    if (newDate && oldDate) {
      return newDate.getTime() > oldDate.getTime();
    }
    // Fall through to lexicographic comparison (works for Gemini's YYYY.MM.DD)
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

// Extract date from human-readable format (e.g., "January 12, 2026")
// Used by ChatGPT and other sources with "Month DD, YYYY" dates
export function extractMonthDayYearDate(html: string): string | null {
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const regex = new RegExp(`(${months})\\s+\\d{1,2},\\s+20\\d{2}`);
  const match = html.match(regex);
  return match ? match[0] : null;
}

// Parse a human-readable date string (e.g., "January 12, 2026") into a Date object
export function parseMonthDayYearDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
  };
  const match = dateStr.match(/^(\w+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  if (!(month in months)) return null;
  return new Date(parseInt(year), months[month], parseInt(day));
}

// Strip Wayback Machine prefix from archived URLs
// e.g. /web/20260210/https://claude.com/blog/slug → https://claude.com/blog/slug
export function extractOriginalUrl(href: string): string {
  const match = href.match(/\/web\/\d+\/(https?:\/\/.+)/);
  return match ? match[1] : href;
}

// Strip HTML tags and normalize whitespace
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
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

// Convert HTML to text preserving paragraph breaks
// Block-level tags become \n\n, <br> becomes \n, then tags are stripped
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, "\n\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")        // collapse horizontal whitespace
    .replace(/ ?\n ?/g, "\n")       // trim spaces around newlines
    .replace(/\n{3,}/g, "\n\n")     // max 2 consecutive newlines
    .trim();
}

// =============================================================================
// Date Entry Parsing Functions (Gemini, ChatGPT)
// =============================================================================

export interface DateEntry {
  title: string;
  date: string;
}

// Extract date-bounded entries from HTML (for Gemini/ChatGPT date-structured pages)
// Returns entries in page order (newest first) with title = first paragraph of each section
// Only matches dates at the start of a line to avoid inline date references
export function extractDateEntries(html: string, datePattern: RegExp): DateEntry[] {
  const text = htmlToText(html);
  const entries: DateEntry[] = [];

  // Only match dates at the start of a line (or start of text)
  const globalPattern = new RegExp(
    `(?:^|\\n)\\s*(${datePattern.source})`,
    "g" + (datePattern.flags.replace("g", ""))
  );
  const dates: { date: string; index: number }[] = [];
  let match;
  while ((match = globalPattern.exec(text)) !== null) {
    // Use the captured group (the date itself), not the full match with \n prefix
    const date = match[1];
    const dateStart = match.index + match[0].indexOf(date);
    dates.push({ date, index: dateStart });
  }

  for (let i = 0; i < dates.length; i++) {
    const contentStart = dates[i].index + dates[i].date.length;
    const contentEnd = i + 1 < dates.length ? dates[i + 1].index : text.length;
    const section = text.slice(contentStart, contentEnd).trim();

    // First non-empty paragraph is the title
    const paragraphs = section.split(/\n\n+/).filter((p) => p.trim());
    let title = paragraphs.length > 0 ? paragraphs[0].trim().replace(/\s+/g, " ") : "";

    // Clean up update notes that start with ":" (e.g., "Feb 3: We fixed...")
    title = title.replace(/^:\s*/, "");

    if (title) {
      entries.push({ title, date: dates[i].date });
    }
  }

  return entries;
}

// Return entries newer than storedDate, or only newest on first run
export function getNewDateEntries(
  entries: DateEntry[],
  storedDate: string | null,
  parserType: "markdown" | "wayback"
): DateEntry[] {
  if (entries.length === 0) return [];

  if (!storedDate) {
    // First run: return only the newest entry
    return entries.slice(0, 1);
  }

  // Return all entries with dates newer than stored
  return entries.filter((e) => isNewerIdentifier(e.date, storedDate, parserType));
}

// =============================================================================
// Blog Parsing Functions
// =============================================================================

export interface BlogPost {
  title: string;
  date: string;
  url?: string;
}

// Extract blog posts (title + date pairs) from blog HTML, newest first
// Uses heading-based parsing: finds <h1>-<h6> elements and looks for a date
// between each heading and the next. Only headings followed by a date are
// treated as blog posts, which naturally excludes nav/toolbar text.
export function extractBlogPosts(html: string): BlogPost[] {
  const posts: BlogPost[] = [];

  // Find all heading elements with their positions and text
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  const headings: { title: string; startIndex: number; endIndex: number }[] = [];
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const title = stripHtml(match[1]);
    if (title) {
      headings.push({
        title,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const dateRegex = new RegExp(`(${months})\\s+\\d{1,2},\\s+20\\d{2}`);

  // For each heading, look for a date between it and the next heading
  for (let i = 0; i < headings.length; i++) {
    const sectionStart = headings[i].endIndex;
    const sectionEnd = i + 1 < headings.length
      ? headings[i + 1].startIndex
      : html.length;
    const section = html.slice(sectionStart, sectionEnd);
    const dateMatch = section.match(dateRegex);

    if (dateMatch) {
      // Look for an article link (e.g. href="/web/TS/https://claude.com/blog/slug")
      const linkMatch = section.match(/href="([^"]*claude\.com\/blog\/[a-z0-9][^"]*)"/);
      const url = linkMatch ? extractOriginalUrl(linkMatch[1]) : undefined;
      posts.push({ title: headings[i].title, date: dateMatch[0], url });
    }
  }

  // Deduplicate by title, keeping the last occurrence.
  // The blog page has a featured section that repeats posts before the
  // chronological list — keeping the last occurrence preserves the
  // chronological ordering.
  const seen = new Set<string>();
  const deduped: BlogPost[] = [];
  for (let i = posts.length - 1; i >= 0; i--) {
    if (!seen.has(posts[i].title)) {
      seen.add(posts[i].title);
      deduped.push(posts[i]);
    }
  }
  deduped.reverse();

  return deduped;
}

// Return all posts that are newer than the stored title
// Posts are assumed to be in page order (newest first)
// On first run (no stored title), returns only the newest post
export function getNewBlogPosts(
  posts: BlogPost[],
  storedTitle: string | null
): BlogPost[] {
  if (posts.length === 0) return [];

  if (!storedTitle) {
    // First run: return only the newest post
    return posts.slice(0, 1);
  }

  // Find the stored title in the list
  const storedIndex = posts.findIndex((p) => p.title === storedTitle);

  if (storedIndex === -1) {
    // Stored title not found — could be removed or page restructured
    // Return only the newest to avoid false positives
    return posts.slice(0, 1);
  }

  if (storedIndex === 0) {
    // No new posts — the newest post is the stored one
    return [];
  }

  // Return posts before the stored title that are also date-newer.
  // The blog page has a featured section with old posts that can appear
  // before the chronological list — date filtering excludes these.
  const storedDate = parseMonthDayYearDate(posts[storedIndex].date);
  const candidates = posts.slice(0, storedIndex);

  if (!storedDate) return candidates;

  return candidates.filter((p) => {
    const pDate = parseMonthDayYearDate(p.date);
    return pDate && pDate.getTime() > storedDate.getTime();
  });
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
  skipRegressionCheck?: boolean; // True when the parser handles its own newness detection (e.g., blog)
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

async function parseWayback(
  source: ReleaseSource,
  storedIdentifier: string | null
): Promise<ParserResult> {
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

  // Blog source: multi-post detection using titles
  if (source.id === "claude-blog") {
    return parseBlogContent(source, html, storedIdentifier);
  }

  // Extract all date entries for multi-entry detection
  const datePattern =
    source.id === "gemini"
      ? /\d{4}\.\d{2}\.\d{2}/
      : new RegExp(
          `(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+20\\d{2}`
        );

  const allEntries = extractDateEntries(html, datePattern);

  if (allEntries.length === 0) {
    // Fall back: try simple date extraction
    const date =
      source.id === "gemini"
        ? extractGeminiDate(html)
        : extractMonthDayYearDate(html);

    if (!date) {
      log.warn("  Could not extract date, using snapshot timestamp");
      return {
        success: true,
        version: snapshot.timestamp,
        content: {
          version: "Update detected",
          formattedChanges: `${source.name} release notes updated.\n\n${source.releasePageUrl}`,
        },
      };
    }

    return {
      success: true,
      version: date,
      content: {
        version: `${stripHtml(date)}:${date}`,
        formattedChanges: `${source.name} (${date}): ${source.releasePageUrl}`,
      },
    };
  }

  const newEntries = getNewDateEntries(allEntries, storedIdentifier, source.parserType);

  if (newEntries.length === 0) {
    // No new entries — return current newest for comparison
    return {
      success: true,
      version: allEntries[0].date,
      content: {
        version: `${allEntries[0].title}:${allEntries[0].date}`,
        formattedChanges: "",
      },
    };
  }

  // Format notification: newest entry's date is stored identifier
  const newest = newEntries[0];
  const reversedNew = [...newEntries].reverse(); // oldest first for chronological reading

  const formattedChanges = reversedNew
    .map((e) => `${e.title} (${e.date})`)
    .join("\n\n")
    + `\n\n${source.releasePageUrl}`;

  return {
    success: true,
    version: newest.date, // Store the newest date
    content: {
      version: `${newest.title}:${newest.date}`,
      formattedChanges,
    },
    skipRegressionCheck: true, // We handle newness detection via getNewDateEntries
  };
}

function parseBlogContent(
  source: ReleaseSource,
  html: string,
  storedTitle: string | null
): ParserResult {
  const posts = extractBlogPosts(html);

  if (posts.length === 0) {
    return { success: false, error: "No blog posts found" };
  }

  const newPosts = getNewBlogPosts(posts, storedTitle);

  if (newPosts.length === 0) {
    // No new posts — return current newest for comparison
    return {
      success: true,
      version: posts[0].title,
      content: {
        version: `${posts[0].title}:${posts[0].date}`,
        formattedChanges: "",
      },
    };
  }

  const newest = newPosts[0];
  const reversedNew = [...newPosts].reverse(); // oldest first for chronological reading

  const formattedChanges = reversedNew
    .map((p) => `${p.title} (${p.date}): ${p.url || source.releasePageUrl}`)
    .join("\n\n");

  return {
    success: true,
    version: newest.title, // Store the newest post title
    content: {
      version: `${newest.title}:${newest.date}`,
      formattedChanges,
    },
    skipRegressionCheck: true, // Blog handles its own newness detection via title matching
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface CheckOptions {
  skipSave?: boolean;
}

export async function checkSource(source: ReleaseSource, options?: CheckOptions): Promise<CheckResult> {
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
        result = await parseWayback(source, storedVersion);
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
    // Skip for parsers that handle their own newness detection (e.g., blog title matching)
    if (
      !result.skipRegressionCheck &&
      storedVersion &&
      result.version &&
      !isNewerIdentifier(result.version, storedVersion, source.parserType)
    ) {
      log.warn(
        `  Extracted ${result.version} is not newer than stored ${storedVersion}, skipping`
      );
      return { source, hasChanged: false };
    }

    // Change detected - save new identifier (unless skipped)
    if (!options?.skipSave) {
      writeStoredData(source, { identifier: result.version });
    }

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
