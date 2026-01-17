import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { ensureDataDir, readStoredData, writeStoredData } from "./hash-store";
import { ReleaseSource } from "./config";

// Mock fs module
vi.mock("fs");

const mockSource: ReleaseSource = {
  id: "claude",
  name: "Claude Code",
  url: "https://example.com/changelog.md",
  parserType: "markdown",
  stateFile: "claude.json",
  releasePageUrl: "https://example.com/changelog",
  slackWebhookUrl: "https://hooks.slack.com/test",
};

describe("ensureDataDir", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    ensureDataDir();

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".data"),
      { recursive: true }
    );
  });

  it("does not create directory if it already exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    ensureDataDir();

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

describe("readStoredData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const result = readStoredData(mockSource);
    expect(result).toBeNull();
  });

  it("parses valid JSON and returns StoredData", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ identifier: "1.2.3" })
    );

    const result = readStoredData(mockSource);
    expect(result).toEqual({ identifier: "1.2.3" });
  });

  it("returns null for invalid JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json");

    const result = readStoredData(mockSource);
    expect(result).toBeNull();
  });

  it("reads from correct file path based on source", () => {
    vi.mocked(fs.readFileSync).mockReturnValue('{"identifier": "1.0.0"}');

    readStoredData(mockSource);

    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("claude.json"),
      "utf8"
    );
  });
});

describe("writeStoredData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("writes JSON data to file", () => {
    writeStoredData(mockSource, { identifier: "1.5.0" });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("claude.json"),
      JSON.stringify({ identifier: "1.5.0" })
    );
  });

  it("ensures data directory exists before writing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeStoredData(mockSource, { identifier: "1.0.0" });

    expect(fs.mkdirSync).toHaveBeenCalled();
  });
});
