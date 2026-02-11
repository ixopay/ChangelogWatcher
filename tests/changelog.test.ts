import { describe, it, expect } from "vitest";
import {
  extractAllVersions,
  compareVersions,
  isNewerIdentifier,
  getVersionsSince,
  stripHtml,
  extractGeminiDate,
  extractMonthDayYearDate,
  parseMonthDayYearDate,
  extractGeminiChanges,
  extractMonthDayYearChanges,
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

describe("extractGeminiChanges", () => {
  const sampleHtml = `
    <div>
      <h2>2025.01.17</h2>
      <p>New Feature Title</p>
      <p>What: Added X</p>
      <p>Why: Because Y</p>
      <h2>2025.01.15</h2>
      <p>Older Feature</p>
      <p>Details here</p>
    </div>
  `;

  it("extracts content for target date", () => {
    const changes = extractGeminiChanges(sampleHtml, "2025.01.17");
    expect(changes).not.toBeNull();
    expect(changes).toContain("New Feature Title");
    expect(changes).toContain("What: Added X");
  });

  it("stops at next date boundary", () => {
    const changes = extractGeminiChanges(sampleHtml, "2025.01.17");
    expect(changes).not.toContain("Older Feature");
  });

  it("returns null for non-existent date", () => {
    const changes = extractGeminiChanges(sampleHtml, "2020.01.01");
    expect(changes).toBeNull();
  });

  it("extracts content for last date in document", () => {
    const changes = extractGeminiChanges(sampleHtml, "2025.01.15");
    expect(changes).not.toBeNull();
    expect(changes).toContain("Older Feature");
  });

  it("removes the date from the returned content", () => {
    const changes = extractGeminiChanges(sampleHtml, "2025.01.17");
    expect(changes).not.toContain("2025.01.17");
  });
});

describe("extractMonthDayYearChanges", () => {
  const sampleHtml = `
    <div>
      <h2>January 17, 2026</h2>
      <p>New Feature Title</p>
      <p>Details about the feature</p>
      <h2>January 10, 2026</h2>
      <p>Older update</p>
      <p>More details</p>
    </div>
  `;

  it("extracts content for target date", () => {
    const changes = extractMonthDayYearChanges(sampleHtml, "January 17, 2026");
    expect(changes).not.toBeNull();
    expect(changes).toContain("New Feature Title");
    expect(changes).toContain("Details about the feature");
  });

  it("stops at next date boundary", () => {
    const changes = extractMonthDayYearChanges(sampleHtml, "January 17, 2026");
    expect(changes).not.toContain("Older update");
  });

  it("returns null for non-existent date", () => {
    const changes = extractMonthDayYearChanges(sampleHtml, "February 1, 2020");
    expect(changes).toBeNull();
  });

  it("extracts content for last date in document", () => {
    const changes = extractMonthDayYearChanges(sampleHtml, "January 10, 2026");
    expect(changes).not.toBeNull();
    expect(changes).toContain("Older update");
  });

  it("removes the date from the returned content", () => {
    const changes = extractMonthDayYearChanges(sampleHtml, "January 17, 2026");
    expect(changes).not.toContain("January 17, 2026");
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

describe("extractBlogPosts", () => {
  it("extracts title/date pairs from blog HTML", () => {
    const html = `
      <div>
        <h2>Introducing Claude 4.5</h2>
        <p>February 10, 2026</p>
        <h2>Claude gets memory</h2>
        <p>January 28, 2026</p>
        <h2>Model Card update</h2>
        <p>January 15, 2026</p>
      </div>
    `;
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(3);
    expect(posts[0].title).toContain("Introducing Claude 4");
    expect(posts[0].date).toBe("February 10, 2026");
    expect(posts[1].date).toBe("January 28, 2026");
    expect(posts[2].date).toBe("January 15, 2026");
  });

  it("returns empty array when no posts found", () => {
    const html = "<html><p>No blog content</p></html>";
    const posts = extractBlogPosts(html);
    expect(posts).toHaveLength(0);
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
});
