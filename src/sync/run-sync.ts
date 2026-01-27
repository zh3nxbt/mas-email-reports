import "dotenv/config";
import { db, schema } from "@/db";
import { syncEmails } from "./syncer";
import { processThreads } from "./thread-processor";

async function main() {
  console.log("=== Job Flow Tracker - Email Sync ===\n");

  try {
    // Step 1: Sync emails from IMAP
    console.log("Step 1: Syncing emails from IMAP...");
    const syncResult = await syncEmails();
    console.log(`  - Synced ${syncResult.emailsSynced} emails`);
    console.log(`  - Processed mailboxes: ${syncResult.mailboxesProcessed.join(", ")}`);
    if (syncResult.errors.length > 0) {
      console.log(`  - Errors: ${syncResult.errors.join(", ")}`);
    }
    console.log();

    // Step 2: Process threads and classify
    console.log("Step 2: Processing threads and classifying...");
    const processResult = await processThreads();
    console.log(`  - Threads processed: ${processResult.threadsProcessed}`);
    console.log(`  - Threads created: ${processResult.threadsCreated}`);
    console.log(`  - Threads updated: ${processResult.threadsUpdated}`);
    console.log(`  - Classifications run: ${processResult.classificationsRun}`);
    if (processResult.errors.length > 0) {
      console.log(`  - Errors: ${processResult.errors.join(", ")}`);
    }
    console.log();

    // Step 3: Summary
    console.log("Step 3: Summary by status:");
    const threads = await db.select().from(schema.threads);
    const statusCounts = threads.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  - ${status}: ${count}`);
    }

    console.log("\n=== Sync complete ===");
    process.exit(0);
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
}

main();
