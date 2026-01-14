# Changelog Watcher

Monitor AI product changelogs and get Slack notifications when updates are released.

Currently monitors:
- **Claude Code** - Anthropic's CLI tool
- **Gemini** - Google's AI assistant
- **ChatGPT** - OpenAI's AI assistant

## How It Works

1. Fetches changelog content from each source
2. Computes a hash and compares with the previous run
3. If changed, sends a notification to Slack with version info
4. Stores the new hash for next comparison

No database required - hashes are stored as simple text files.

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/blueohsix/ChangelogWatcher.git
cd ChangelogWatcher
npm install
```

### 2. Configure Slack Webhooks

Create a `.env` file with your Slack webhook URLs:

```bash
cp .env.example .env
# Edit .env with your webhook URLs
```

The webhooks should be [Slack Workflow Builder](https://slack.com/help/articles/360041352714-Create-more-advanced-workflows-using-webhooks) triggers that accept `source`, `version`, and `changes` fields.

### 3. Run

```bash
# Check all sources
npm run check

# Check individual sources
npm run check:claude
npm run check:gemini
npm run check:chatgpt

# Dry run (no notifications)
npm run check:dry
```

## Automated Scheduling

### GitHub Actions (Recommended)

The included workflow runs hourly automatically. Just add your webhook URLs as repository secrets:

1. Go to **Settings > Secrets and variables > Actions**
2. Add secrets:
   - `SLACK_WEBHOOK_CLAUDE`
   - `SLACK_WEBHOOK_GEMINI`
   - `SLACK_WEBHOOK_CHATGPT`

You can also trigger manually from the Actions tab.

### Other Options

- **Cron**: `0 * * * * cd /path/to/ChangelogWatcher && npm run check`
- **Any scheduler**: Just run `npm run check`

## Adding a New Source

Edit `src/config.ts` to add a new source:

```typescript
newsource: {
  id: "newsource",
  name: "New Source",
  url: "https://example.com/changelog",
  parserType: "markdown", // or "hash-only" or "wayback"
  hashFileName: "changelog_newsource.hash",
  releasePageUrl: "https://example.com/changelog",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_NEWSOURCE || "",
},
```

Parser types:
- `markdown` - Raw markdown file, extracts version from headers
- `hash-only` - HTML page, detects any content change
- `wayback` - Uses Wayback Machine for pages that block bots

## Project Structure

```
src/
├── index.ts        # CLI entry point
├── config.ts       # Source definitions
├── changelog.ts    # Fetch and hash logic
├── slack.ts        # Slack notifications
├── hash-store.ts   # File-based hash storage
└── logger.ts       # Console logging
```

## License

MIT
