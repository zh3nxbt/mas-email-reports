import "dotenv/config";
import { runDailySummary, runMorningReminder, runMiddayReport } from "./generator";
import { syncEmails } from "@/sync/syncer";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import type { ReportOptions } from "./types";
import type { ReportType } from "@/db/schema";

function parseArgs(): { morning: boolean; midday: boolean; noBackfill: boolean; options: ReportOptions } {
  const args = process.argv.slice(2);
  const morning = args.includes("--morning");
  const midday = args.includes("--midday");
  const preview = args.includes("--preview");
  const skipEmail = args.includes("--skip-email");
  const reanalyze = args.includes("--reanalyze");
  const noBackfill = args.includes("--no-backfill");

  let date: Date | undefined;
  const dateArg = args.find((arg) => arg.startsWith("--date="));
  if (dateArg) {
    const dateStr = dateArg.split("=")[1];
    date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.error(`Invalid date: ${dateStr}`);
      process.exit(1);
    }
  }

  return {
    morning,
    midday,
    noBackfill,
    options: { date, preview, skipEmail, reanalyze },
  };
}

function printUsage() {
  console.log(`
Usage: npm run report [options]

Options:
  --morning      Generate 7am morning reminder instead of 4pm daily summary
  --midday       Generate 12pm midday report instead of 4pm daily summary
  --preview      Output to console, don't save or email
  --skip-email   Save to database but don't send email
  --reanalyze    Force re-analysis of all threads (bypass cache)
  --date=YYYY-MM-DD  Generate report for a specific date
  --no-backfill  Skip backfilling missing reports (run requested report only)

Examples:
  npm run report                    # Generate and send 4pm daily summary
  npm run report -- --preview       # Preview daily summary in console
  npm run report -- --morning       # Generate and send 7am morning reminder
  npm run report -- --midday        # Generate and send 12pm midday report
  npm run report -- --date=2024-01-15 --preview   # Preview historical report
  npm run report -- --reanalyze     # Re-analyze all threads with AI (after prompt changes)
`);
}

// Report types in chronological order within a day
type ReportSlot = { date: string; type: ReportType };

// Check if a report exists in the database
async function reportExists(date: string, type: ReportType): Promise<boolean> {
  const existing = await db
    .select({ id: schema.dailyReports.id })
    .from(schema.dailyReports)
    .where(
      and(
        eq(schema.dailyReports.reportDate, date),
        eq(schema.dailyReports.reportType, type)
      )
    )
    .limit(1);
  return existing.length > 0;
}

// Get the sequence of reports needed before the target report
// Returns reports in chronological order (oldest first)
function getRequiredPrecedingReports(targetDate: Date, targetType: ReportType): ReportSlot[] {
  const reports: ReportSlot[] = [];
  const dateStr = targetDate.toISOString().split("T")[0];

  // Calculate yesterday's date
  const yesterday = new Date(targetDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // Report chain: ... -> 4pm (day-1) -> 7am -> 12pm -> 4pm -> ...
  // Each report depends on the previous one in the chain

  if (targetType === "morning_reminder") {
    // 7am depends on previous day's 4pm
    reports.push({ date: yesterdayStr, type: "daily_summary" });
  } else if (targetType === "midday_report") {
    // 12pm depends on same day's 7am, which depends on previous day's 4pm
    reports.push({ date: yesterdayStr, type: "daily_summary" });
    reports.push({ date: dateStr, type: "morning_reminder" });
  } else if (targetType === "daily_summary") {
    // 4pm depends on same day's 12pm, which depends on 7am, which depends on previous 4pm
    reports.push({ date: yesterdayStr, type: "daily_summary" });
    reports.push({ date: dateStr, type: "morning_reminder" });
    reports.push({ date: dateStr, type: "midday_report" });
  }

  return reports;
}

// Check for missing reports and backfill them
async function backfillMissingReports(
  targetDate: Date,
  targetType: ReportType,
  options: ReportOptions
): Promise<void> {
  const required = getRequiredPrecedingReports(targetDate, targetType);
  const missing: ReportSlot[] = [];

  // Check which required reports are missing
  for (const slot of required) {
    const exists = await reportExists(slot.date, slot.type);
    if (!exists) {
      missing.push(slot);
    }
  }

  if (missing.length === 0) {
    return;
  }

  console.log(`\n=== Backfilling ${missing.length} missing report(s) ===\n`);

  // Run missing reports in chronological order
  for (const slot of missing) {
    const reportDate = new Date(slot.date + "T12:00:00"); // Midday to avoid timezone issues
    const backfillOptions: ReportOptions = {
      ...options,
      date: reportDate,
      // For backfill, always skip email (we'll send the final requested report)
      skipEmail: true,
      preview: false,
    };

    console.log(`Backfilling: ${slot.type} for ${slot.date}`);

    if (slot.type === "daily_summary") {
      await runDailySummary(backfillOptions);
    } else if (slot.type === "morning_reminder") {
      await runMorningReminder(backfillOptions);
    } else if (slot.type === "midday_report") {
      await runMiddayReport(backfillOptions);
    }
  }

  console.log(`\n=== Backfill complete, now running requested report ===\n`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const { morning, midday, noBackfill, options } = parseArgs();

  try {
    // Sync emails first (unless previewing historical data)
    if (!options.date) {
      console.log("Syncing emails...");
      const syncResult = await syncEmails();
      console.log(`Synced ${syncResult.emailsSynced} emails\n`);
    }

    // Determine target report type
    const targetType: ReportType = morning
      ? "morning_reminder"
      : midday
        ? "midday_report"
        : "daily_summary";

    // Backfill missing reports unless in preview mode or explicitly disabled
    if (!options.preview && !noBackfill) {
      const targetDate = options.date || new Date();
      await backfillMissingReports(targetDate, targetType, options);
    }

    if (morning) {
      await runMorningReminder(options);
    } else if (midday) {
      await runMiddayReport(options);
    } else {
      await runDailySummary(options);
    }
    process.exit(0);
  } catch (error) {
    console.error("Report generation failed:", error);
    process.exit(1);
  }
}

main();
