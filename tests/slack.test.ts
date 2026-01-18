import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSlackNotification, SlackPayload } from "../src/slack";

const testPayload: SlackPayload = {
  source: "Claude Code",
  version: "1.2.3",
  changes: "New features added",
};

describe("sendSlackNotification", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns error for empty webhook URL", async () => {
    const result = await sendSlackNotification("", testPayload);
    expect(result.success).toBe(false);
    expect(result.error).toBe("No webhook URL configured");
  });

  it("returns success for 200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
    });

    const result = await sendSlackNotification(
      "https://hooks.slack.com/test",
      testPayload
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns error with status for non-200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("invalid_payload"),
    });

    const result = await sendSlackNotification(
      "https://hooks.slack.com/test",
      testPayload
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("400: invalid_payload");
  });

  it("handles network errors", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await sendSlackNotification(
      "https://hooks.slack.com/test",
      testPayload
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("sends correct payload format", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    await sendSlackNotification("https://hooks.slack.com/test", testPayload);

    expect(global.fetch).toHaveBeenCalledWith("https://hooks.slack.com/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });
  });
});
