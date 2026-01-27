import "dotenv/config";
import { db, schema } from "@/db";
import { processThreads } from "./thread-processor";

async function main() {
  console.log("=== Re-classify Threads ===\n");

  try {
    // Step 1: Clear only threads (keep emails)
    console.log("Step 1: Clearing existing threads...");
    await db.delete(schema.threadEmails);
    await db.delete(schema.threads);
    console.log("  - Cleared threads and thread_emails (emails kept)\n");

    // Step 2: Re-process and classify
    console.log("Step 2: Processing threads and classifying...");
    const processResult = await processThreads();
    console.log(`  - Threads processed: ${processResult.threadsProcessed}`);
    console.log(`  - Threads created: ${processResult.threadsCreated}`);
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

    console.log("\n=== Re-classification complete ===");
    process.exit(0);
  } catch (error) {
    console.error("Re-classification failed:", error);
    process.exit(1);
  }
}

main();
