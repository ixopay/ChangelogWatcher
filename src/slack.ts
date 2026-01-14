export interface SlackPayload {
  source: string;
  version: string;
  changes: string;
}

export interface SlackResult {
  success: boolean;
  error?: string;
}

export async function sendSlackNotification(
  webhookUrl: string,
  payload: SlackPayload
): Promise<SlackResult> {
  if (!webhookUrl) {
    return { success: false, error: "No webhook URL configured" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { success: true };
    }

    const text = await response.text();
    return { success: false, error: `${response.status}: ${text}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}
