import "dotenv/config";
import { SOURCES, SourceId, SLACK_WEBHOOK_URL } from "./config";
import { checkSource } from "./changelog";
import { sendSlackNotification } from "./slack";
import * as log from "./logger";

const VALID_TARGETS = ["all", "claude-code", "claude-blog", "gemini", "chatgpt"] as const;
type Target = (typeof VALID_TARGETS)[number];

function printUsage(): void {
  console.log(`
Changelog Watcher - Monitor AI changelogs and notify Slack

Usage:
  npx tsx src/index.ts [target] [options]

Targets:
  all           Check all sources (default)
  claude-code   Check Claude Code changelog only
  claude-blog   Check Claude Blog only
  gemini        Check Gemini changelog only
  chatgpt       Check ChatGPT changelog only

Options:
  --dry-run   Check for changes without sending notifications
  --test      Send notifications to the test channel instead of live
  --help      Show this help message

Examples:
  npx tsx src/index.ts                  # Check all sources
  npx tsx src/index.ts claude-code      # Check Claude Code only
  npx tsx src/index.ts claude-blog      # Check Claude Blog only
  npx tsx src/index.ts --dry-run        # Dry run all sources
  npx tsx src/index.ts gemini --dry-run
  npx tsx src/index.ts --test           # Send to test channel
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const testMode = args.includes("--test");
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
  if (testMode) {
    log.warn("TEST MODE - Notifications will be sent to the test channel");
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

    const result = await checkSource(source, { skipSave: testMode });

    if (result.error) {
      if (result.isTransient) {
        // Transient errors (e.g., Wayback down) are warnings, not failures
        log.warn(`  ${result.error} (skipped)`);
      } else {
        log.error(`  ${result.error}`);
        errorsEncountered++;
      }
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

    const slackResult = await sendSlackNotification(SLACK_WEBHOOK_URL, {
      source: source.name,
      version: result.version || "Update detected",
      changes: result.formattedChanges || `Check: ${source.releasePageUrl}`,
      test: testMode ? "yes" : "no",
    });

    if (slackResult.success) {
      log.success(`  Notification sent to Slack`);
    } else {
      log.error(`  Failed to notify: ${slackResult.error}`);
      errorsEncountered++;
    }
  }

  // Trigger Wayback Machine to save fresh snapshots for wayback sources
  const waybackSources = sourcesToCheck.filter((s) => s.parserType === "wayback");
  if (waybackSources.length > 0) {
    console.log();
    log.info("Triggering Wayback Machine saves...");
    await Promise.all(
      waybackSources.map(async (source) => {
        const saveUrl = `https://web.archive.org/save/${source.url}`;
        try {
          log.info(`  Saving ${source.name}: ${saveUrl}`);
          const res = await fetch(saveUrl);
          log.info(`  ${source.name}: ${res.status}`);
        } catch (err) {
          log.warn(`  ${source.name}: save failed (${err instanceof Error ? err.message : String(err)})`);
        }
      })
    );
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
