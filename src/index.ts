import "dotenv/config";
import { SOURCES, SourceId } from "./config";
import { checkSource } from "./changelog";
import { sendSlackNotification } from "./slack";
import * as log from "./logger";

const VALID_TARGETS = ["all", "claude", "gemini", "chatgpt"] as const;
type Target = (typeof VALID_TARGETS)[number];

function printUsage(): void {
  console.log(`
Changelog Watcher - Monitor AI changelogs and notify Slack

Usage:
  npx tsx src/index.ts [target] [options]

Targets:
  all       Check all sources (default)
  claude    Check Claude Code changelog only
  gemini    Check Gemini changelog only
  chatgpt   Check ChatGPT changelog only

Options:
  --dry-run   Check for changes without sending notifications
  --help      Show this help message

Examples:
  npx tsx src/index.ts              # Check all sources
  npx tsx src/index.ts claude       # Check Claude only
  npx tsx src/index.ts --dry-run    # Dry run all sources
  npx tsx src/index.ts gemini --dry-run
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const target = (args.find((a) => !a.startsWith("--")) || "all") as Target;

  if (!VALID_TARGETS.includes(target)) {
    log.error(`Invalid target: ${target}`);
    printUsage();
    process.exit(1);
  }

  console.log("=".repeat(50));
  console.log("  Changelog Watcher");
  console.log("=".repeat(50));
  if (dryRun) {
    log.warn("DRY RUN MODE - No notifications will be sent");
  }
  console.log();

  const sourcesToCheck =
    target === "all"
      ? Object.values(SOURCES)
      : [SOURCES[target as SourceId]];

  let changesDetected = 0;
  let errorsEncountered = 0;

  for (const source of sourcesToCheck) {
    log.info(`Checking ${source.name}...`);

    const result = await checkSource(source);

    if (result.error) {
      log.error(`  ${result.error}`);
      errorsEncountered++;
      continue;
    }

    if (!result.hasChanged) {
      log.info(`  No changes detected`);
      continue;
    }

    changesDetected++;
    log.success(`  Change detected! Version: ${result.version}`);

    if (dryRun) {
      log.warn(`  [DRY RUN] Would send notification`);
      continue;
    }

    const slackResult = await sendSlackNotification(source.slackWebhookUrl, {
      source: source.name,
      version: result.version || "Update detected",
      changes: result.formattedChanges || `Check: ${source.releasePageUrl}`,
    });

    if (slackResult.success) {
      log.success(`  Notification sent to Slack`);
    } else {
      log.error(`  Failed to notify: ${slackResult.error}`);
      errorsEncountered++;
    }
  }

  console.log();
  console.log("=".repeat(50));
  log.info(
    `Done. Checked: ${sourcesToCheck.length}, Changed: ${changesDetected}, Errors: ${errorsEncountered}`
  );

  if (errorsEncountered > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
