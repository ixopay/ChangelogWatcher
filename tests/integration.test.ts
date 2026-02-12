import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSource } from "../src/changelog";
import { ReleaseSource } from "../src/config";
import * as hashStore from "../src/hash-store";

// Mock dependencies
vi.mock("../src/hash-store");
vi.mock("../src/logger", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Test fixtures
const mockClaudeSource: ReleaseSource = {
  id: "claude-code",
  name: "Claude Code",
  url: "https://example.com/changelog.md",
  parserType: "markdown",
  stateFile: "claude-code.json",
  releasePageUrl: "https://example.com/changelog",
};

const mockGeminiSource: ReleaseSource = {
  id: "gemini",
  name: "Gemini",
  url: "https://gemini.google/release-notes/",
  parserType: "wayback",
  stateFile: "gemini.json",
  releasePageUrl: "https://gemini.google/release-notes/",
};

const mockChatGPTSource: ReleaseSource = {
  id: "chatgpt",
  name: "ChatGPT",
  url: "https://help.openai.com/chatgpt-release-notes",
  parserType: "wayback",
  stateFile: "chatgpt.json",
  releasePageUrl: "https://help.openai.com/chatgpt-release-notes",
};

const mockClaudeBlogSource: ReleaseSource = {
  id: "claude-blog",
  name: "Claude Blog",
  url: "https://claude.com/blog",
  parserType: "wayback",
  stateFile: "claude-blog.json",
  releasePageUrl: "https://claude.com/blog",
};

describe("checkSource integration", () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("markdown parser (Claude Code)", () => {
    const sampleChangelog = `# Changelog

## [1.2.0]
- Added feature X
- Fixed bug Y

## [1.1.0]
- Added feature A

## [1.0.0]
- Initial release`;

    it("handles first run - no stored state", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChangelog),
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toBe("1.2.0");
      expect(result.formattedChanges).toContain("Added feature X");
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockClaudeSource, {
        identifier: "1.2.0",
      });
    });

    it("skips state save when skipSave is true", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChangelog),
      });

      const result = await checkSource(mockClaudeSource, { skipSave: true });

      expect(result.hasChanged).toBe(true);
      expect(result.version).toBe("1.2.0");
      expect(hashStore.writeStoredData).not.toHaveBeenCalled();
    });

    it("detects single version change", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "1.1.0",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChangelog),
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toBe("1.2.0");
      expect(result.formattedChanges).toContain("Added feature X");
      expect(result.formattedChanges).not.toContain("Initial release");
    });

    it("detects multiple missed versions", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "1.0.0",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChangelog),
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(true);
      // Version should show range
      expect(result.version).toBe("1.1.0 → 1.2.0");
      // Changes should include both versions
      expect(result.formattedChanges).toContain("Added feature X");
      expect(result.formattedChanges).toContain("Added feature A");
      // Stored version should be the newest
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockClaudeSource, {
        identifier: "1.2.0",
      });
    });

    it("returns no change when versions match", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "1.2.0",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChangelog),
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(false);
      expect(result.version).toBeUndefined();
      expect(hashStore.writeStoredData).not.toHaveBeenCalled();
    });

    it("handles fetch failure gracefully", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("Failed to fetch Claude Code changelog");
      expect(hashStore.writeStoredData).not.toHaveBeenCalled();
    });

    it("handles empty changelog gracefully", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("# Changelog\n\nNo versions yet."),
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("No versions found in changelog");
    });

    it("handles network error gracefully", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("wayback parser (Gemini)", () => {
    const sampleGeminiHtml = `
      <html>
        <h2>2025.01.17</h2>
        <p>New Feature Title</p>
        <p>What: Added X</p>
        <p>Why: Because Y</p>
        <h2>2025.01.15</h2>
        <p>Older Feature</p>
      </html>
    `;

    it("handles first run - no stored state", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      // Mock CDX API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      // Mock Wayback snapshot fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleGeminiHtml),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("New Feature Title");
      expect(result.version).toContain("2025.01.17");
      expect(result.formattedChanges).toContain("New Feature Title");
      // URL should appear once at end, not per-entry
      expect(result.formattedChanges).toContain(mockGeminiSource.releasePageUrl);
      expect(result.formattedChanges!.endsWith(mockGeminiSource.releasePageUrl)).toBe(true);
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockGeminiSource, {
        identifier: "2025.01.17",
      });
    });

    it("detects multiple missed entries with URL once at end", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "2025.01.10",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleGeminiHtml),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(true);
      // Should include both entries
      expect(result.formattedChanges).toContain("New Feature Title");
      expect(result.formattedChanges).toContain("Older Feature");
      expect(result.formattedChanges).toContain("2025.01.17");
      expect(result.formattedChanges).toContain("2025.01.15");
      // URL should appear once at end, not per-entry
      expect(result.formattedChanges!.endsWith(mockGeminiSource.releasePageUrl)).toBe(true);
      // Count occurrences — URL should appear exactly once
      const urlCount = result.formattedChanges!.split(mockGeminiSource.releasePageUrl).length - 1;
      expect(urlCount).toBe(1);
      // Stored identifier is the newest date
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockGeminiSource, {
        identifier: "2025.01.17",
      });
    });

    it("detects single date change", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "2025.01.15",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleGeminiHtml),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("New Feature Title");
      expect(result.version).toContain("2025.01.17");
    });

    it("returns no change when date matches", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "2025.01.17",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleGeminiHtml),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(false);
      expect(hashStore.writeStoredData).not.toHaveBeenCalled();
    });

    it("handles CDX API failure with isTransient flag", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      // CDX API returns empty/invalid response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("No Wayback snapshot available via CDX");
      expect(result.isTransient).toBe(true);
    });

    it("handles CDX API network failure", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      // Simulate all retries failing
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("No Wayback snapshot available via CDX");
      expect(result.isTransient).toBe(true);
    });

    it("handles snapshot fetch failure with isTransient flag", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      // CDX API succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      // Snapshot fetch fails (all retries)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("Failed to fetch Wayback content");
      expect(result.isTransient).toBe(true);
    });

    it("falls back to timestamp when date extraction fails", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20250117120000", "https://gemini.google/release-notes/"],
          ]),
      });

      // HTML without recognizable date format
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("<html><p>No date here</p></html>"),
      });

      const result = await checkSource(mockGeminiSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toBe("Update detected");
      // Falls back to using timestamp as identifier
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockGeminiSource, {
        identifier: "20250117120000",
      });
    });
  });

  describe("wayback parser (ChatGPT)", () => {
    const sampleChatGPTHtml = `
      <html>
        <h2>January 17, 2026</h2>
        <p>New Feature Title</p>
        <p>Details about the feature</p>
        <h2>January 10, 2026</h2>
        <p>Older update</p>
      </html>
    `;

    it("handles first run with ChatGPT date format", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20260117120000", "https://help.openai.com/chatgpt-release-notes"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChatGPTHtml),
      });

      const result = await checkSource(mockChatGPTSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("New Feature Title");
      expect(result.version).toContain("January 17, 2026");
      expect(result.formattedChanges).toContain("New Feature Title");
      // URL should appear once at end
      expect(result.formattedChanges).toContain(mockChatGPTSource.releasePageUrl);
      expect(result.formattedChanges!.endsWith(mockChatGPTSource.releasePageUrl)).toBe(true);
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(
        mockChatGPTSource,
        {
          identifier: "January 17, 2026",
        }
      );
    });

    it("detects multiple missed entries with URL once at end", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "January 1, 2026",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20260117120000", "https://help.openai.com/chatgpt-release-notes"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChatGPTHtml),
      });

      const result = await checkSource(mockChatGPTSource);

      expect(result.hasChanged).toBe(true);
      // Should include both new entries
      expect(result.formattedChanges).toContain("New Feature Title");
      expect(result.formattedChanges).toContain("Older update");
      expect(result.formattedChanges).toContain("January 17, 2026");
      expect(result.formattedChanges).toContain("January 10, 2026");
      // URL should appear once at end, not per-entry
      expect(result.formattedChanges!.endsWith(mockChatGPTSource.releasePageUrl)).toBe(true);
      const urlCount = result.formattedChanges!.split(mockChatGPTSource.releasePageUrl).length - 1;
      expect(urlCount).toBe(1);
    });

    it("detects single date change", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "January 10, 2026",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20260117120000", "https://help.openai.com/chatgpt-release-notes"],
          ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(sampleChatGPTHtml),
      });

      const result = await checkSource(mockChatGPTSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("New Feature Title");
      expect(result.version).toContain("January 17, 2026");
    });
  });

  describe("wayback parser (Claude Blog)", () => {
    const sampleBlogHtml = `
      <html>
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
      </html>
    `;

    function mockWaybackSuccess(html: string) {
      // CDX API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            ["timestamp", "original"],
            ["20260210120000", "https://claude.com/blog"],
          ]),
      });
      // Wayback snapshot fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });
    }

    it("handles first run - stores newest post title with per-post URL", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);
      mockWaybackSuccess(sampleBlogHtml);

      const result = await checkSource(mockClaudeBlogSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("Introducing Claude 4.5");
      expect(result.version).toContain("February 10, 2026");
      expect(result.formattedChanges).toContain("Introducing Claude 4");
      // Per-post URL should be the article URL, not the blog index
      expect(result.formattedChanges).toContain("https://claude.com/blog/introducing-claude-4-5");
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(
        mockClaudeBlogSource,
        expect.objectContaining({ identifier: expect.stringContaining("Introducing Claude 4") })
      );
    });

    it("detects single new post with per-post URL", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "Claude gets memory",
      });
      mockWaybackSuccess(sampleBlogHtml);

      const result = await checkSource(mockClaudeBlogSource);

      expect(result.hasChanged).toBe(true);
      expect(result.formattedChanges).toContain("Introducing Claude 4");
      expect(result.formattedChanges).not.toContain("Claude gets memory");
      // Verify "Title (Date): article-URL" format
      expect(result.formattedChanges).toContain("(February 10, 2026)");
      expect(result.formattedChanges).toContain("https://claude.com/blog/introducing-claude-4-5");
    });

    it("detects multiple new posts with per-post URLs", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "Model Card update",
      });
      mockWaybackSuccess(sampleBlogHtml);

      const result = await checkSource(mockClaudeBlogSource);

      expect(result.hasChanged).toBe(true);
      expect(result.version).toContain("Introducing Claude 4.5");
      expect(result.version).toContain("February 10, 2026");
      expect(result.formattedChanges).toContain("Introducing Claude 4");
      expect(result.formattedChanges).toContain("Claude gets memory");
      // Each post should have its own article URL
      expect(result.formattedChanges).toContain("https://claude.com/blog/introducing-claude-4-5");
      expect(result.formattedChanges).toContain("https://claude.com/blog/claude-gets-memory");
    });

    it("returns no change when newest title matches stored", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue({
        identifier: "Introducing Claude 4.5",
      });
      mockWaybackSuccess(sampleBlogHtml);

      const result = await checkSource(mockClaudeBlogSource);

      expect(result.hasChanged).toBe(false);
      expect(hashStore.writeStoredData).not.toHaveBeenCalled();
    });

    it("handles Wayback failure with isTransient flag", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      // CDX API returns empty/invalid response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await checkSource(mockClaudeBlogSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("No Wayback snapshot available via CDX");
      expect(result.isTransient).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles unknown parser type", async () => {
      vi.mocked(hashStore.readStoredData).mockReturnValue(null);

      const unknownSource: ReleaseSource = {
        ...mockClaudeSource,
        parserType: "unknown" as "markdown",
      };

      const result = await checkSource(unknownSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("Unknown parser type");
    });

    it("catches and reports unexpected errors", async () => {
      vi.mocked(hashStore.readStoredData).mockImplementation(() => {
        throw new Error("Unexpected file system error");
      });

      const result = await checkSource(mockClaudeSource);

      expect(result.hasChanged).toBe(false);
      expect(result.error).toBe("Unexpected file system error");
    });
  });
});
