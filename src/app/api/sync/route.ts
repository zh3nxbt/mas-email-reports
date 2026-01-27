import { NextResponse } from "next/server";
import { syncEmails } from "@/sync/syncer";
import { processThreads } from "@/sync/thread-processor";

export async function POST() {
  try {
    // Step 1: Sync emails from IMAP
    const syncResult = await syncEmails();

    // Step 2: Process threads and classify
    const processResult = await processThreads();

    return NextResponse.json({
      success: true,
      sync: {
        emailsSynced: syncResult.emailsSynced,
        mailboxesProcessed: syncResult.mailboxesProcessed,
        errors: syncResult.errors,
      },
      process: {
        threadsProcessed: processResult.threadsProcessed,
        threadsCreated: processResult.threadsCreated,
        threadsUpdated: processResult.threadsUpdated,
        classificationsRun: processResult.classificationsRun,
        errors: processResult.errors,
      },
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: String(error) },
      { status: 500 }
    );
  }
}
