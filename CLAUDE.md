# Claude Code Context

This is a simple changelog monitoring tool that checks for updates to AI product changelogs and sends Slack notifications.

## Project Structure

```
src/
├── index.ts        # CLI entry point - parses args, orchestrates checks
├── config.ts       # Source definitions (URLs, webhook env vars)
├── changelog.ts    # Core logic: fetch, parse, compare
├── slack.ts        # Slack webhook notification
├── hash-store.ts   # File-based state persistence
└── logger.ts       # Console logging with colors
tests/
└── *.test.ts       # Unit and integration tests (Vitest)
```

## Key Commands

```bash
npm run check              # Check all sources
npm run check:claude-code  # Check Claude Code only
npm run check:claude-blog  # Check Claude Blog only
npm run check:gemini       # Check Gemini only
npm run check:chatgpt      # Check ChatGPT only
npm run check:dry          # Dry run (no notifications)
npm run typecheck          # TypeScript type checking
npm run test               # Run tests once
npm run test:watch         # Watch mode testing
npm run test:coverage      # Generate coverage reports
```

## How It Works

1. Fetches changelog content from configured URLs
2. Extracts version/date identifier from each source
3. Compares with stored state in `.data/*.json`
4. If changed: sends Slack notification, saves new state

## Parser Types

- `markdown`: Direct fetch, extracts semver from headers (Claude Code)
- `wayback`: Wayback Machine archive, extracts date (Gemini, ChatGPT) or blog posts (Claude Blog)

## Sources

- **Claude Code** (`claude-code`): Monitors Claude Code's CHANGELOG.md via direct fetch
- **Claude Blog** (`claude-blog`): Monitors https://claude.com/blog via Wayback Machine, detects new blog posts by title
- **Gemini** (`gemini`): Monitors Gemini release notes via Wayback Machine
- **ChatGPT** (`chatgpt`): Monitors ChatGPT release notes via Wayback Machine

## Environment Variables

Slack webhook URLs are configured via environment variables:
- `SLACK_WEBHOOK_CLAUDE_CODE`
- `SLACK_WEBHOOK_CLAUDE_BLOG`
- `SLACK_WEBHOOK_GEMINI`
- `SLACK_WEBHOOK_CHATGPT`

## Adding a New Source

1. Add entry to `SOURCES` in `src/config.ts`
2. Add corresponding `SLACK_WEBHOOK_*` env var
3. Add secret to GitHub Actions if using CI

## Design Principles

- No frameworks - plain TypeScript
- Minimal dependencies (dotenv, semver)
- File-based state (no database)
- Single responsibility per file
