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
npm run check:claude       # Check Claude only
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
- `wayback`: Wayback Machine archive, extracts date (Gemini, ChatGPT)

## Environment Variables

Slack webhook URLs are configured via environment variables:
- `SLACK_WEBHOOK_CLAUDE`
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
