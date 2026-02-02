/**
 * Check and clean up email_po_attachments table
 *
 * 1. Find attachments for non-po_received emails (should be deleted)
 * 2. Find po_received emails missing attachments (need to be processed)
 *
 * Usage:
 *   npx tsx src/db/check-po-attachments.ts           # Check only
 *   npx tsx src/db/check-po-attachments.ts --fix     # Delete invalid + show missing
 */

import "dotenv/config";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { deletePdf, isSupabaseConfigured } from "@/storage/supabase-client";
import { groupEmailsIntoThreads } from "@/sync/threader";

interface CheckResult {
  invalidAttachments: Array<{
    id: number;
    threadKey: string;
    filename: string;
    storagePath: string;
    emailId: number | null;
  }>;
  missingAttachments: Array<{
    threadKey: string;
    subject: string;
    contactEmail: string | null;
    emailId: number;
    attachments: string | null;
  }>;
}

async function checkAttachments(): Promise<CheckResult> {
  console.log("=== Checking email_po_attachments ===\n");

  // Get all po_received threadKeys from report_threads and qb_sync_alerts
  const poThreadsFromReports = await db
    .select({ threadKey: schema.reportThreads.threadKey })
    .from(schema.reportThreads)
    .where(eq(schema.reportThreads.itemType, "po_received"));

  const poThreadsFromAlerts = await db
    .select({ threadKey: schema.qbSyncAlerts.threadKey })
    .from(schema.qbSyncAlerts);

  const validPoThreadKeys = new Set([
    ...poThreadsFromReports.map((r) => r.threadKey),
    ...poThreadsFromAlerts.map((a) => a.threadKey).filter(Boolean) as string[],
  ]);

  console.log(`Found ${validPoThreadKeys.size} valid po_received threadKeys`);
  console.log(`  - From report_threads: ${poThreadsFromReports.length}`);
  console.log(`  - From qb_sync_alerts: ${poThreadsFromAlerts.length}`);

  // Get all attachments
  const allAttachments = await db.select().from(schema.poAttachments);
  console.log(`\nTotal attachments in email_po_attachments: ${allAttachments.length}`);

  // Find invalid attachments (not in po_received threads)
  const invalidAttachments = allAttachments.filter(
    (att) => !validPoThreadKeys.has(att.threadKey)
  );

  console.log(`\n--- Invalid Attachments (not po_received): ${invalidAttachments.length} ---`);
  for (const att of invalidAttachments) {
    console.log(`  ID: ${att.id}`);
    console.log(`    ThreadKey: ${att.threadKey.slice(0, 50)}...`);
    console.log(`    File: ${att.filename}`);
    console.log(`    Path: ${att.storagePath}`);
  }

  // Find po_received emails with PDF/DOC attachments but no entry in email_po_attachments
  // First get all emails and group into threads
  const allEmails = await db.select().from(schema.emails);
  const threadMap = groupEmailsIntoThreads(allEmails);

  console.log(`\nTotal emails: ${allEmails.length}`);
  console.log(`Total threads: ${threadMap.size}`);

  // Get threadKeys that already have attachments stored
  const storedThreadKeys = new Set(allAttachments.map((a) => a.threadKey));

  // Find missing: po_received threadKeys with PDF emails but no stored attachment
  const missingAttachments: CheckResult["missingAttachments"] = [];

  for (const threadKey of validPoThreadKeys) {
    if (storedThreadKeys.has(threadKey)) continue; // Already has attachment

    // Get emails for this thread
    const threadEmails = threadMap.get(threadKey);
    if (!threadEmails) continue;

    // Check if any email has PDF/DOC attachment
    const emailsWithDocs = threadEmails.filter((e) => {
      if (!e.hasAttachments || !e.attachments) return false;
      const lower = e.attachments.toLowerCase();
      return lower.includes("pdf") || lower.includes(".doc");
    });

    if (emailsWithDocs.length === 0) continue;

    // Get thread info from report_threads
    const threadInfo = await db
      .select()
      .from(schema.reportThreads)
      .where(eq(schema.reportThreads.threadKey, threadKey))
      .limit(1);

    const subject = threadInfo[0]?.subject || threadEmails[0]?.subject || "(no subject)";
    const contactEmail = threadInfo[0]?.contactEmail || null;

    for (const email of emailsWithDocs) {
      missingAttachments.push({
        threadKey,
        subject,
        contactEmail,
        emailId: email.id,
        attachments: email.attachments,
      });
    }
  }

  console.log(`\n--- Missing Attachments (po_received without stored PDF): ${missingAttachments.length} ---`);
  for (const missing of missingAttachments.slice(0, 10)) {
    console.log(`  ThreadKey: ${missing.threadKey.slice(0, 50)}...`);
    console.log(`    Subject: ${missing.subject.slice(0, 50)}...`);
    console.log(`    Email ID: ${missing.emailId}`);
    console.log(`    Attachments: ${missing.attachments}`);
  }
  if (missingAttachments.length > 10) {
    console.log(`  ... and ${missingAttachments.length - 10} more`);
  }

  return { invalidAttachments, missingAttachments };
}

async function deleteInvalidAttachments(
  attachments: CheckResult["invalidAttachments"]
): Promise<void> {
  if (attachments.length === 0) {
    console.log("\nNo invalid attachments to delete.");
    return;
  }

  console.log(`\n=== Deleting ${attachments.length} invalid attachments ===\n`);

  const supabaseConfigured = isSupabaseConfigured();

  for (const att of attachments) {
    // Delete from Supabase Storage (if configured)
    if (supabaseConfigured) {
      console.log(`Deleting from Supabase: ${att.storagePath}`);
      const { error } = await deletePdf(att.storagePath);
      if (error) {
        console.warn(`  Warning: ${error}`);
      }
    }

    // Delete from database
    console.log(`Deleting from DB: ID ${att.id}`);
    await db.delete(schema.poAttachments).where(eq(schema.poAttachments.id, att.id));
  }

  console.log(`\nDeleted ${attachments.length} invalid attachments.`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");

  const result = await checkAttachments();

  console.log("\n=== Summary ===");
  console.log(`Invalid attachments (non-po_received): ${result.invalidAttachments.length}`);
  console.log(`Missing attachments (po_received without PDF): ${result.missingAttachments.length}`);

  if (shouldFix) {
    await deleteInvalidAttachments(result.invalidAttachments);

    if (result.missingAttachments.length > 0) {
      console.log("\nTo process missing attachments, run:");
      console.log("  npm run jobs:check -- --since=2025-01-01");
      console.log("This will re-analyze po_received threads and store their PDFs.");
    }
  } else {
    if (result.invalidAttachments.length > 0 || result.missingAttachments.length > 0) {
      console.log("\nRun with --fix to delete invalid attachments:");
      console.log("  npx tsx src/db/check-po-attachments.ts --fix");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
