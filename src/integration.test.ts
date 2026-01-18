import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSource } from "./changelog";
import { ReleaseSource } from "./config";
import * as hashStore from "./hash-store";

// Mock dependencies
vi.mock("./hash-store");
vi.mock("./logger", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Test fixtures
const mockClaudeSource: ReleaseSource = {
  id: "claude",
  name: "Claude Code",
  url: "https://example.com/changelog.md",
  parserType: "markdown",
  stateFile: "claude.json",
  releasePageUrl: "https://example.com/changelog",
  slackWebhookUrl: "",
};

const mockGeminiSource: ReleaseSource = {
  id: "gemini",
  name: "Gemini",
  url: "https://gemini.google/release-notes/",
  parserType: "wayback",
  stateFile: "gemini.json",
  releasePageUrl: "https://gemini.google/release-notes/",
  slackWebhookUrl: "",
};

const mockChatGPTSource: ReleaseSource = {
  id: "chatgpt",
  name: "ChatGPT",
  url: "https://help.openai.com/chatgpt-release-notes",
  parserType: "wayback",
  stateFile: "chatgpt.json",
  releasePageUrl: "https://help.openai.com/chatgpt-release-notes",
  slackWebhookUrl: "",
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
      expect(result.version).toBe("Updated 2025.01.17");
      expect(result.formattedChanges).toContain("New Feature Title");
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(mockGeminiSource, {
        identifier: "2025.01.17",
      });
    });

    it("detects date change", async () => {
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
      expect(result.version).toBe("Updated 2025.01.17");
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
      expect(result.version).toBe("Updated January 17, 2026");
      expect(result.formattedChanges).toContain("New Feature Title");
      expect(hashStore.writeStoredData).toHaveBeenCalledWith(
        mockChatGPTSource,
        {
          identifier: "January 17, 2026",
        }
      );
    });

    it("detects date change with ChatGPT format", async () => {
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
      expect(result.version).toBe("Updated January 17, 2026");
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
