/**
 * Sync emails and store all PO attachments to Supabase Storage
 *
 * This script:
 * 1. Syncs emails from IMAP (incremental)
 * 2. Uses existing po_received threadKeys from report_threads table
 * 3. For each thread, fetches and stores PDF/DOCX attachments
 * 4. DOCX/DOC files are converted to PDF before storing
 *
 * Note: This does NOT re-categorize threads (no Claude API calls).
 * It relies on existing categorization from previous report runs.
 *
 * Usage:
 *   npm run store-po-attachments
 *   npm run store-po-attachments -- --skip-sync
 */

import "dotenv/config";
import { db, schema } from "@/db";
import { eq, inArray, like, or } from "drizzle-orm";
import { syncEmails } from "@/sync/syncer";
import { fetchAndStorePdfs } from "./po-attachment-manager";
import { groupEmailsIntoThreads } from "@/sync/threader";
import type { Email } from "@/db/schema";

interface Stats {
  emailsSynced: number;
  poReceivedThreadKeys: number;
  emailsProcessed: number;
  attachmentsStored: number;
  attachmentsSkipped: number;
  wordConverted: number;
  errors: number;
}

async function main() {
  const args = process.argv.slice(2);
  const skipSync = args.includes("--skip-sync");

  console.log("========================================");
  console.log("  Store PO Attachments to Supabase");
  console.log("========================================\n");

  const stats: Stats = {
    emailsSynced: 0,
    poReceivedThreadKeys: 0,
    emailsProcessed: 0,
    attachmentsStored: 0,
    attachmentsSkipped: 0,
    wordConverted: 0,
    errors: 0,
  };

  // Step 1: Sync emails (optional)
  if (!skipSync) {
    console.log("Step 1: Syncing emails from IMAP...\n");
    try {
      const syncResult = await syncEmails();
      stats.emailsSynced = syncResult.emailsSynced;
      console.log(`Synced ${syncResult.emailsSynced} new emails\n`);
    } catch (error) {
      console.error("Sync failed:", error);
      process.exit(1);
    }
  } else {
    console.log("Step 1: Skipping email sync (--skip-sync)\n");
  }

  // Step 2: Get po_received threadKeys from multiple sources
  console.log("Step 2: Finding PO threads from multiple sources...\n");

  // Source 1: report_threads table
  const poThreadRecords = await db
    .select({ threadKey: schema.reportThreads.threadKey })
    .from(schema.reportThreads)
    .where(eq(schema.reportThreads.itemType, "po_received"));
  const reportThreadKeys = poThreadRecords.map(r => r.threadKey);
  console.log(`  report_threads: ${reportThreadKeys.length} po_received`);

  // Source 2: qb_sync_alerts table (all alerts are for PO threads)
  const alertRecords = await db
    .select({ threadKey: schema.qbSyncAlerts.threadKey })
    .from(schema.qbSyncAlerts);
  const alertThreadKeys = alertRecords.map(r => r.threadKey).filter(Boolean) as string[];
  console.log(`  qb_sync_alerts: ${alertThreadKeys.length} alerts`);

  // Combine and dedupe
  const poThreadKeys = [...new Set([...reportThreadKeys, ...alertThreadKeys])];
  stats.poReceivedThreadKeys = poThreadKeys.length;
  console.log(`  Combined unique: ${poThreadKeys.length} threadKeys\n`);

  if (poThreadKeys.length === 0) {
    console.log("No PO threads found. Run a report or jobs:check first.");
    process.exit(0);
  }

  // Step 3: Get all emails and group into threads
  console.log("Step 3: Loading emails and grouping into threads...\n");

  const allEmails = await db.select().from(schema.emails);
  const threadMap = groupEmailsIntoThreads(allEmails);
  console.log(`Loaded ${allEmails.length} emails in ${threadMap.size} threads\n`);

  // Step 3b: Find additional PO threads by subject pattern (fallback)
  // This catches emails like Diamond FC's "PO" subject that might not be categorized yet
  const poSubjectPattern = /\b(p\.?o\.?|purchase\s*order)\b/i;
  const additionalPoThreadKeys: string[] = [];

  for (const [threadKey, emails] of threadMap.entries()) {
    if (poThreadKeys.includes(threadKey)) continue; // Already have it

    // Check if any email in thread has PO-like subject AND has PDF/DOC attachment
    const hasPoPdf = emails.some(e => {
      const subjectMatch = poSubjectPattern.test(e.subject || "");
      const hasDoc = e.attachments?.toLowerCase().includes("pdf") ||
                     e.attachments?.toLowerCase().includes(".doc");
      return subjectMatch && hasDoc && e.hasAttachments;
    });

    if (hasPoPdf) {
      additionalPoThreadKeys.push(threadKey);
    }
  }

  if (additionalPoThreadKeys.length > 0) {
    console.log(`Found ${additionalPoThreadKeys.length} additional PO threads by subject pattern`);
    poThreadKeys.push(...additionalPoThreadKeys);
    stats.poReceivedThreadKeys = poThreadKeys.length;
  }

  // Step 4: Process each po_received thread
  console.log("Step 4: Storing PO attachments...\n");

  for (const threadKey of poThreadKeys) {
    // Find the thread emails
    const threadEmails = threadMap.get(threadKey);
    if (!threadEmails) {
      console.log(`Thread not found: ${threadKey.substring(0, 40)}...`);
      continue;
    }

    // Find emails with PDF/DOCX attachments
    const emailsWithDocs = threadEmails.filter((e: Email) => {
      if (!e.hasAttachments || !e.attachments) return false;
      const lower = e.attachments.toLowerCase();
      return lower.includes("pdf") || lower.includes(".doc");
    });

    if (emailsWithDocs.length === 0) continue;

    // Get subject from first email in thread
    const subject = threadEmails[0]?.subject || "(no subject)";
    console.log(`\nThread: ${subject.substring(0, 55)}...`);
    console.log(`  ${emailsWithDocs.length} email(s) with PDF/DOC attachments`);

    for (const email of emailsWithDocs) {
      stats.emailsProcessed++;

      try {
        const stored = await fetchAndStorePdfs(email, threadKey);

        for (const att of stored) {
          if (att.originalFilename) {
            stats.wordConverted++;
            console.log(`  Converted: ${att.originalFilename} → ${att.filename}`);
          }
          stats.attachmentsStored++;
        }

        if (stored.length === 0) {
          stats.attachmentsSkipped++;
        }
      } catch (error) {
        console.error(`  Error processing email ${email.uid}:`, error);
        stats.errors++;
      }
    }
  }

  // Summary
  console.log("\n========================================");
  console.log("  Summary");
  console.log("========================================");
  console.log(`Emails synced:           ${stats.emailsSynced}`);
  console.log(`PO threadKeys found:     ${stats.poReceivedThreadKeys}`);
  console.log(`Emails processed:        ${stats.emailsProcessed}`);
  console.log(`Attachments stored:      ${stats.attachmentsStored}`);
  console.log(`Attachments skipped:     ${stats.attachmentsSkipped}`);
  console.log(`Word docs converted:     ${stats.wordConverted}`);
  console.log(`Errors:                  ${stats.errors}`);

  process.exit(0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
