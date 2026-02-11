import path from "path";

export type SourceId = "claude-code" | "claude-blog" | "gemini" | "chatgpt";

export interface ReleaseSource {
  id: SourceId;
  name: string;
  url: string;
  parserType: "markdown" | "wayback";
  stateFile: string;
  releasePageUrl: string;
  slackWebhookUrl: string;
}

export const SOURCES: Record<SourceId, ReleaseSource> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    url: "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    parserType: "markdown",
    stateFile: "claude-code.json",
    releasePageUrl: "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_CLAUDE_CODE || "",
  },
  "claude-blog": {
    id: "claude-blog",
    name: "Claude Blog",
    url: "https://claude.com/blog",
    parserType: "wayback",
    stateFile: "claude-blog.json",
    releasePageUrl: "https://claude.com/blog",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_CLAUDE_BLOG || "",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google/release-notes/",
    parserType: "wayback",
    stateFile: "gemini.json",
    releasePageUrl: "https://gemini.google/release-notes/",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_GEMINI || "",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
    parserType: "wayback",
    stateFile: "chatgpt.json",
    releasePageUrl:
      "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_CHATGPT || "",
  },
};

export const DATA_DIR = path.join(process.cwd(), ".data");
