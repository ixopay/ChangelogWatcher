import { describe, it, expect } from "vitest";
import {
  extractAllVersions,
  compareVersions,
  isNewerIdentifier,
  getVersionsSince,
  stripHtml,
  htmlToText,
  extractOriginalUrl,
  extractGeminiDate,
  extractMonthDayYearDate,
  parseMonthDayYearDate,
  extractDateEntries,
  getNewDateEntries,
  extractBlogPosts,
  getNewBlogPosts,
  VersionEntry,
} from "../src/changelog";

describe("extractAllVersions", () => {
  it("extracts versions from markdown headers with brackets", () => {
    const content = `# Changelog

## [1.2.0]
- Added feature A

## [1.1.0]
- Added feature B

## [1.0.0]
- Initial release`;

    const versions = extractAllVersions(content);
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe("1.2.0");
    expect(versions[1].version).toBe("1.1.0");
    expect(versions[2].version).toBe("1.0.0");
  });

  it("extracts versions from markdown headers without brackets", () => {
    const content = `# 2.0.0
Some changes

# 1.0.0
Initial`;

    const versions = extractAllVersions(content);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe("2.0.0");
    expect(versions[1].version).toBe("1.0.0");
  });

  it("handles mixed header levels", () => {
    const content = `# [3.0.0]
Major

## [2.0.0]
Minor

### [1.0.0]
Patch`;

    const versions = extractAllVersions(content);
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.version)).toEqual(["3.0.0", "2.0.0", "1.0.0"]);
  });

  it("returns empty array for content with no versions", () => {
    const content = `# Changelog

Some text without versions.`;

    const versions = extractAllVersions(content);
    expect(versions).toHaveLength(0);
  });

  it("captures content between version headers", () => {
    const content = `## [1.1.0]
- Feature A
- Feature B

## [1.0.0]
- Initial release`;

    const versions = extractAllVersions(content);
    expect(versions[0].changes).toContain("Feature A");
    expect(versions[0].changes).toContain("Feature B");
    expect(versions[1].changes).toContain("Initial release");
  });

  it("handles versions with pre-release suffixes in brackets", () => {
    const content = `## [1.0.0-beta]
Beta features

## [1.0.0-alpha]
Alpha features`;

    const versions = extractAllVersions(content);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe("1.0.0-beta");
    expect(versions[1].version).toBe("1.0.0-alpha");
  });
});

describe("compareVersions", () => {
  it("returns 1 when first version is greater (major)", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
  });

  it("returns 1 when first version is greater (minor)", () => {
    expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
  });

  it("returns 1 when first version is greater (patch)", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });

  it("returns -1 when first version is smaller", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 0 when versions are equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("handles different version lengths (shorter first)", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("handles different version lengths (longer first)", () => {
    expect(compareVersions("1.0.0", "1.0")).toBe(0);
  });

  it("handles single digit versions", () => {
    expect(compareVersions("2", "1")).toBe(1);
  });

  it("handles pre-release versions (beta < release)", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
  });

  it("handles pre-release versions (alpha < beta)", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });

  it("handles pre-release with numbers (rc.1 < rc.2)", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
  });
});

describe("isNewerIdentifier", () => {
  describe("markdown parser (semver)", () => {
    it("returns true when new version is greater", () => {
      expect(isNewerIdentifier("1.1.0", "1.0.0", "markdown")).toBe(true);
    });

    it("returns false when new version is smaller", () => {
      expect(isNewerIdentifier("1.0.0", "1.1.0", "markdown")).toBe(false);
    });

    it("returns false when versions are equal", () => {
      expect(isNewerIdentifier("1.0.0", "1.0.0", "markdown")).toBe(false);
    });

    it("handles pre-release versions correctly", () => {
      expect(isNewerIdentifier("1.0.0", "1.0.0-beta", "markdown")).toBe(true);
      expect(isNewerIdentifier("1.0.0-beta", "1.0.0", "markdown")).toBe(false);
    });
  });

  describe("wayback parser (YYYY.MM.DD dates)", () => {
    it("returns true when new date is later", () => {
      expect(isNewerIdentifier("2026.01.20", "2025.12.17", "wayback")).toBe(
        true
      );
    });

    it("returns false when new date is earlier", () => {
      expect(isNewerIdentifier("2025.12.17", "2026.01.20", "wayback")).toBe(
        false
      );
    });

    it("returns false when dates are equal", () => {
      expect(isNewerIdentifier("2026.01.20", "2026.01.20", "wayback")).toBe(
        false
      );
    });

    it("handles year boundary correctly", () => {
      expect(isNewerIdentifier("2026.01.01", "2025.12.31", "wayback")).toBe(
        true
      );
    });
  });
});

describe("getVersionsSince", () => {
  const testVersions: VersionEntry[] = [
    { version: "1.3.0", changes: "Third" },
    { version: "1.2.0", changes: "Second" },
    { version: "1.1.0", changes: "First" },
  ];

  it("returns only latest version when no stored version (first run)", () => {
    const result = getVersionsSince(testVersions, null);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("1.3.0");
  });

  it("filters to versions newer than stored version", () => {
    const result = getVersionsSince(testVersions, "1.1.0");
    expect(result).toHaveLength(2);
    expect(result[0].version).toBe("1.3.0");
    expect(result[1].version).toBe("1.2.0");
  });

  it("returns empty array when no new versions", () => {
    const result = getVersionsSince(testVersions, "1.3.0");
    expect(result).toHaveLength(0);
  });

  it("returns all versions when stored version is very old", () => {
    const result = getVersionsSince(testVersions, "0.1.0");
    expect(result).toHaveLength(3);
  });

  it("handles empty version list", () => {
    const result = getVersionsSince([], "1.0.0");
    expect(result).toHaveLength(0);
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(stripHtml(html)).toBe("Hello world");
  });

  it("decodes &amp; entity", () => {
    expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
  });

  it("decodes &lt; entity", () => {
    expect(stripHtml("a &lt; b")).toBe("a < b");
  });

  it("decodes &gt; entity", () => {
    expect(stripHtml("a &gt; b")).toBe("a > b");
  });

  it("decodes &quot; entity", () => {
    expect(stripHtml("Say &quot;hello&quot;")).toBe('Say "hello"');
  });

  it("decodes &#039; entity", () => {
    expect(stripHtml("It&#039;s fine")).toBe("It's fine");
  });

  it("decodes &nbsp; entity", () => {
    expect(stripHtml("hello&nbsp;world")).toBe("hello world");
  });

  it("normalizes multiple whitespace to single space", () => {
    expect(stripHtml("hello    world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(stripHtml("  hello  ")).toBe("hello");
  });

  it("handles complex HTML", () => {
    const html =
      "<div class='test'><p>Hello &amp; <em>world</em>!</p></div>";
    expect(stripHtml(html)).toBe("Hello & world !");
  });

  it("removes script element content", () => {
    const html = "<p>Hello</p><script>var x = 1; alert('xss');</script><p>world</p>";
    expect(stripHtml(html)).toBe("Hello world");
  });

  it("removes style element content", () => {
    const html = "<p>Hello</p><style>.foo { color: red; }</style><p>world</p>";
    expect(stripHtml(html)).toBe("Hello world");
  });

  it("removes script with attributes", () => {
    const html = '<p>Hello</p><script type="text/javascript">var x = 1;</script><p>world</p>';
    expect(stripHtml(html)).toBe("Hello world");
  });

  it("removes multiple script/style elements", () => {
    const html = "<script>a</script><p>Hello</p><style>b</style><script>c</script><p>world</p>";
    expect(stripHtml(html)).toBe("Hello world");
  });
});

describe("htmlToText", () => {
  it("preserves paragraph breaks", () => {
    const html = "<p>First paragraph</p><p>Second paragraph</p>";
    expect(htmlToText(html)).toBe("First paragraph\n\nSecond paragraph");
  });

  it("converts br to single newline", () => {
    const html = "Line one<br>Line two<br/>Line three";
    expect(htmlToText(html)).toBe("Line one\nLine two\nLine three");
  });

  it("removes script and style content", () => {
    const html = "<p>Hello</p><script>var x = 1;</script><style>.a{}</style><p>World</p>";
    expect(htmlToText(html)).toBe("Hello\n\nWorld");
  });

  it("handles heading close tags as block breaks", () => {
    const html = "<h2>Title</h2><p>Content</p>";
    expect(htmlToText(html)).toBe("Title\n\nContent");
  });

  it("collapses excessive newlines to max two", () => {
    const html = "<p>A</p><div></div><div></div><div></div><p>B</p>";
    const result = htmlToText(html);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("A");
    expect(result).toContain("B");
  });
});

describe("extractGeminiDate", () => {
  it("extracts YYYY.MM.DD format", () => {
    const html = "<p>Updated on 2025.01.15</p>";
    expect(extractGeminiDate(html)).toBe("2025.01.15");
  });

  it("extracts first date when multiple present", () => {
    const html = "2025.01.15 and 2025.01.10";
    expect(extractGeminiDate(html)).toBe("2025.01.15");
  });

  it("returns null when no date found", () => {
    const html = "<p>No date here</p>";
    expect(extractGeminiDate(html)).toBeNull();
  });

  it("does not match invalid date formats", () => {
    const html = "2025-01-15"; // Wrong separator
    expect(extractGeminiDate(html)).toBeNull();
  });
});

describe("extractMonthDayYearDate", () => {
  it("extracts Month DD, YYYY format", () => {
    const html = "<p>January 15, 2026</p>";
    expect(extractMonthDayYearDate(html)).toBe("January 15, 2026");
  });

  it("handles single digit day", () => {
    const html = "December 5, 2025";
    expect(extractMonthDayYearDate(html)).toBe("December 5, 2025");
  });

  it("extracts first date when multiple present", () => {
    const html = "January 15, 2026 and December 10, 2025";
    expect(extractMonthDayYearDate(html)).toBe("January 15, 2026");
  });

  it("returns null when no date found", () => {
    const html = "<p>No date here</p>";
    expect(extractMonthDayYearDate(html)).toBeNull();
  });

  it("handles all months", () => {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    for (const month of months) {
      const html = `${month} 1, 2025`;
      expect(extractMonthDayYearDate(html)).toBe(`${month} 1, 2025`);
    }
  });

  it("does not match YYYY.MM.DD format", () => {
    const html = "2025.01.15";
    expect(extractMonthDayYearDate(html)).toBeNull();
  });
});

describe("parseMonthDayYearDate", () => {
  it("parses a valid human-readable date", () => {
    const date = parseMonthDayYearDate("January 12, 2026");
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(0); // January = 0
    expect(date!.getDate()).toBe(12);
  });

  it("parses all months correctly", () => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    for (let i = 0; i < months.length; i++) {
      const date = parseMonthDayYearDate(`${months[i]} 1, 2025`);
      expect(date).not.toBeNull();
      expect(date!.getMonth()).toBe(i);
    }
  });

  it("returns null for invalid format", () => {
    expect(parseMonthDayYearDate("2025.01.15")).toBeNull();
    expect(parseMonthDayYearDate("")).toBeNull();
    expect(parseMonthDayYearDate("not a date")).toBeNull();
  });

  it("returns null for invalid month name", () => {
    expect(parseMonthDayYearDate("Smarch 1, 2025")).toBeNull();
  });
});

describe("isNewerIdentifier - human-readable dates", () => {
  it("correctly compares dates across months (February > January)", () => {
    expect(isNewerIdentifier("February 1, 2026", "January 30, 2026", "wayback")).toBe(true);
  });

  it("correctly compares dates within same month", () => {
    expect(isNewerIdentifier("January 20, 2026", "January 10, 2026", "wayback")).toBe(true);
  });

  it("returns false when earlier date is compared to later", () => {
    expect(isNewerIdentifier("January 10, 2026", "January 20, 2026", "wayback")).toBe(false);
  });

  it("returns false when dates are equal", () => {
    expect(isNewerIdentifier("January 15, 2026", "January 15, 2026", "wayback")).toBe(false);
  });

  it("correctly compares across year boundaries", () => {
    expect(isNewerIdentifier("January 1, 2026", "December 31, 2025", "wayback")).toBe(true);
  });

  it("still works with YYYY.MM.DD format (Gemini)", () => {
    expect(isNewerIdentifier("2026.01.20", "2025.12.17", "wayback")).toBe(true);
  });
});

describe("extractDateEntries", () => {
  it("extracts Gemini-style date entries", () => {
    const html = `
      <h2>2025.01.17</h2>
      <p>New Feature Title</p>
      <p>What: Added X</p>
      <h2>2025.01.15</h2>
      <p>Older Feature</p>
    `;
    const entries = extractDateEntries(html, /\d{4}\.\d{2}\.\d{2}/);
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe("2025.01.17");
    expect(entries[0].title).toContain("New Feature Title");
    expect(entries[1].date).toBe("2025.01.15");
    expect(entries[1].title).toContain("Older Feature");
  });

  it("extracts ChatGPT-style date entries", () => {
    const html = `
      <h2>January 17, 2026</h2>
      <p>New Feature Title</p>
      <p>Details about the feature</p>
      <h2>January 10, 2026</h2>
      <p>Older update</p>
    `;
    const monthPattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}/;
    const entries = extractDateEntries(html, monthPattern);
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe("January 17, 2026");
    expect(entries[0].title).toContain("New Feature Title");
    expect(entries[1].date).toBe("January 10, 2026");
  });

  it("returns empty array when no dates found", () => {
    const html = "<p>No dates here</p>";
    const entries = extractDateEntries(html, /\d{4}\.\d{2}\.\d{2}/);
    expect(entries).toHaveLength(0);
  });

  it("collapses newlines within titles to single spaces", () => {
    const html = `
      <h2>2026.01.28</h2>
      <p>Meet
      your new AI browsing assistant:
      Gemini in Chrome</p>
    `;
    const entries = extractDateEntries(html, /\d{4}\.\d{2}\.\d{2}/);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Meet your new AI browsing assistant: Gemini in Chrome");
  });
});

describe("getNewDateEntries", () => {
  const entries = [
    { title: "Feature C", date: "2025.01.20" },
    { title: "Feature B", date: "2025.01.17" },
    { title: "Feature A", date: "2025.01.15" },
  ];

  it("returns only newest entry on first run (no stored date)", () => {
    const result = getNewDateEntries(entries, null, "wayback");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Feature C");
  });

  it("returns entries newer than stored date", () => {
    const result = getNewDateEntries(entries, "2025.01.15", "wayback");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Feature C");
    expect(result[1].title).toBe("Feature B");
  });

  it("returns single new entry", () => {
    const result = getNewDateEntries(entries, "2025.01.17", "wayback");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Feature C");
  });

  it("returns empty when no new entries", () => {
    const result = getNewDateEntries(entries, "2025.01.20", "wayback");
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty entry list", () => {
    const result = getNewDateEntries([], "2025.01.15", "wayback");
    expect(result).toHaveLength(0);
  });

  it("works with Month DD, YYYY format", () => {
    const monthEntries = [
      { title: "Update C", date: "February 1, 2026" },
      { title: "Update B", date: "January 20, 2026" },
      { title: "Update A", date: "January 10, 2026" },
    ];
    const result = getNewDateEntries(monthEntries, "January 10, 2026", "wayback");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Update C");
    expect(result[1].title).toBe("Update B");
  });
});

describe("extractOriginalUrl", () => {
  it("strips Wayback Machine prefix from URL", () => {
    expect(
      extractOriginalUrl("/web/20260210120000/https://claude.com/blog/introducing-claude-4")
    ).toBe("https://claude.com/blog/introducing-claude-4");
  });

  it("handles http URLs", () => {
    expect(
      extractOriginalUrl("/web/20260210/http://example.com/page")
    ).toBe("http://example.com/page");
  });

  it("returns original string when no Wayback prefix", () => {
    expect(extractOriginalUrl("https://claude.com/blog/slug")).toBe(
      "https://claude.com/blog/slug"
    );
  });

  it("returns original string for relative paths", () => {
    expect(extractOriginalUrl("/blog/slug")).toBe("/blog/slug");
  });
});

describe("extractBlogPosts", () => {
  it("extracts title/date/url from blog HTML with article links", () => {
    const html = `
      <div>
        <h2>Introducing Claude 4.5</h2>
        <p>February 10, 2026</p>
        <div><a href="/web/20260210120000/https://claude.com/blog/introducing-claude-4-5">Read more</a></div>
        <h2>Claude gets memory</h2>
        <p>January 28, 2026</p>
        <div><a href="/web/20260210120000/https://claude.com/blog/claude-gets-memory">Read more</a></div>
        <h2>Model Card update</h2>
        <p>January 15, 2026</p>
        <div><a href="/web/20260210120000/https://claude.com/blog/model-card-update">Read more</a></div>
      </div>
    `;
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(3);
    expect(posts[0].title).toContain("Introducing Claude 4");
    expect(posts[0].date).toBe("February 10, 2026");
    expect(posts[0].url).toBe("https://claude.com/blog/introducing-claude-4-5");
    expect(posts[1].date).toBe("January 28, 2026");
    expect(posts[1].url).toBe("https://claude.com/blog/claude-gets-memory");
    expect(posts[2].date).toBe("January 15, 2026");
    expect(posts[2].url).toBe("https://claude.com/blog/model-card-update");
  });

  it("sets url to undefined when no article link is present", () => {
    const html = `
      <div>
        <h2>Some Post</h2>
        <p>January 15, 2026</p>
      </div>
    `;
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe("Some Post");
    expect(posts[0].url).toBeUndefined();
  });

  it("returns empty array when no posts found", () => {
    const html = "<html><p>No blog content</p></html>";
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(0);
  });

  it("excludes headings without dates (nav/toolbar)", () => {
    const html = `
      <h1>Claude Blog</h1>
      <nav><h3>Menu</h3></nav>
      <h2>Real Blog Post</h2>
      <p>January 15, 2026</p>
    `;
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe("Real Blog Post");
  });

  it("deduplicates posts from featured section, keeping chronological order", () => {
    const html = `
      <!-- Featured section -->
      <h2>Old Featured Post</h2>
      <p>January 1, 2026</p>
      <div><a href="/web/20260210/https://claude.com/blog/old-featured">Read more</a></div>
      <h2>Another Featured</h2>
      <p>December 15, 2025</p>

      <!-- Chronological section -->
      <h2>Brand New Post</h2>
      <p>February 12, 2026</p>
      <div><a href="/web/20260212/https://claude.com/blog/brand-new">Read more</a></div>
      <h2>Old Featured Post</h2>
      <p>January 1, 2026</p>
      <div><a href="/web/20260210/https://claude.com/blog/old-featured">Read more</a></div>
      <h2>Another Featured</h2>
      <p>December 15, 2025</p>
    `;
    const posts = extractBlogPosts(html);
    // Should be 3 unique posts, not 5
    expect(posts).toHaveLength(3);
    // Chronological order preserved: newest first
    expect(posts[0].title).toBe("Brand New Post");
    expect(posts[1].title).toBe("Old Featured Post");
    expect(posts[2].title).toBe("Another Featured");
  });

  it("handles Wayback HTML with script/style in headings section", () => {
    const html = `
      <script>var wayback = true;</script>
      <style>.wm-ipp { display: block; }</style>
      <h2>Introducing Claude 4.5</h2>
      <p>February 10, 2026</p>
      <div><a href="/web/20260210/https://claude.com/blog/introducing-claude-4-5">Read more</a></div>
      <h2>Claude gets memory</h2>
      <p>January 28, 2026</p>
      <div><a href="/web/20260210/https://claude.com/blog/claude-gets-memory">Read more</a></div>
    `;
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe("Introducing Claude 4.5");
    expect(posts[0].url).toBe("https://claude.com/blog/introducing-claude-4-5");
    expect(posts[1].title).toBe("Claude gets memory");
    expect(posts[1].url).toBe("https://claude.com/blog/claude-gets-memory");
  });
});

describe("getNewBlogPosts", () => {
  const posts = [
    { title: "Post C", date: "February 10, 2026" },
    { title: "Post B", date: "January 28, 2026" },
    { title: "Post A", date: "January 15, 2026" },
  ];

  it("returns only newest post on first run (no stored title)", () => {
    const result = getNewBlogPosts(posts, null);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Post C");
  });

  it("returns new posts since stored title", () => {
    const result = getNewBlogPosts(posts, "Post A");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Post C");
    expect(result[1].title).toBe("Post B");
  });

  it("returns single new post", () => {
    const result = getNewBlogPosts(posts, "Post B");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Post C");
  });

  it("returns empty when no new posts", () => {
    const result = getNewBlogPosts(posts, "Post C");
    expect(result).toHaveLength(0);
  });

  it("returns newest post when stored title not found", () => {
    const result = getNewBlogPosts(posts, "Deleted Post");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Post C");
  });

  it("returns empty for empty post list", () => {
    const result = getNewBlogPosts([], "Post A");
    expect(result).toHaveLength(0);
  });

  it("filters out featured-section posts older than stored post's date", () => {
    // Simulates page with featured section (old posts) before chronological list
    const postsWithFeatured = [
      { title: "Old Featured", date: "October 1, 2025" },       // featured, older
      { title: "Another Old", date: "August 15, 2025" },        // featured, older
      { title: "New Post B", date: "February 10, 2026" },       // chronological, newer
      { title: "New Post A", date: "January 28, 2026" },        // chronological, newer
      { title: "Stored Post", date: "January 12, 2026" },       // stored
      { title: "Before Stored", date: "December 19, 2025" },    // older
    ];
    const result = getNewBlogPosts(postsWithFeatured, "Stored Post");
    // Should only return the 2 actually new posts, not the featured ones
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("New Post B");
    expect(result[1].title).toBe("New Post A");
  });
});
