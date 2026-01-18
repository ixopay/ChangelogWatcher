import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as logger from "../src/logger";

describe("logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("info", () => {
    it("logs message with blue INFO label", () => {
      logger.info("test message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("INFO");
      expect(output).toContain("test message");
      expect(output).toContain("\x1b[34m"); // Blue color code
    });

    it("includes timestamp in HH:MM:SS format", () => {
      logger.info("test");

      const output = consoleSpy.mock.calls[0][0];
      // Timestamp format: [HH:MM:SS]
      expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });
  });

  describe("success", () => {
    it("logs message with green OK label", () => {
      logger.success("test message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("OK");
      expect(output).toContain("test message");
      expect(output).toContain("\x1b[32m"); // Green color code
    });
  });

  describe("warn", () => {
    it("logs message with yellow WARN label", () => {
      logger.warn("warning message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("WARN");
      expect(output).toContain("warning message");
      expect(output).toContain("\x1b[33m"); // Yellow color code
    });
  });

  describe("error", () => {
    it("logs message with red ERROR label", () => {
      logger.error("error message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("ERROR");
      expect(output).toContain("error message");
      expect(output).toContain("\x1b[31m"); // Red color code
    });
  });
});
