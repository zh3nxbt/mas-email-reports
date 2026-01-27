import "dotenv/config";
import { db, schema } from "@/db";
import { eq, count, gt } from "drizzle-orm";
import { groupEmailsIntoThreads, identifyCustomer, normalizeSubject } from "./threader";
import { classifyThread, prepareEmailsForClassification } from "./classifier";
import type { Email, NewThread, ThreadStatus } from "@/db/schema";

const OUR_EMAIL = process.env.OUR_EMAIL || "sales@masprecisionparts.com";
const OUR_DOMAIN = OUR_EMAIL.split("@")[1] || "masprecisionparts.com";

// Batch size for processing emails to prevent OOM
const EMAIL_BATCH_SIZE = 500;

export interface ProcessStats {
  threadsProcessed: number;
  threadsCreated: number;
  threadsUpdated: number;
  classificationsRun: number;
  errors: string[];
}

/**
 * Fetches emails in batches to prevent memory issues with large mailboxes.
 * Uses cursor-based pagination with the email ID.
 */
async function* fetchEmailsInBatches(batchSize: number): AsyncGenerator<Email[]> {
  let lastId = 0;

  while (true) {
    const batch = await db
      .select()
      .from(schema.emails)
      .where(gt(schema.emails.id, lastId))
      .orderBy(schema.emails.id)
      .limit(batchSize);

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1].id;
    yield batch;
  }
}

/**
 * Gets the total count of emails for progress reporting.
 */
async function getEmailCount(): Promise<number> {
  const result = await db.select({ total: count() }).from(schema.emails);
  return result[0]?.total || 0;
}

export async function processThreads(): Promise<ProcessStats> {
  const stats: ProcessStats = {
    threadsProcessed: 0,
    threadsCreated: 0,
    threadsUpdated: 0,
    classificationsRun: 0,
    errors: [],
  };

  const totalEmails = await getEmailCount();
  console.log(`Processing ${totalEmails} emails into threads (batch size: ${EMAIL_BATCH_SIZE})...`);

  // Collect all emails in batches to build thread groups
  // We need all emails to properly group threads, but we fetch in batches
  const allEmails: Email[] = [];
  let batchNumber = 0;

  for await (const batch of fetchEmailsInBatches(EMAIL_BATCH_SIZE)) {
    batchNumber++;
    allEmails.push(...batch);
    console.log(`  Loaded batch ${batchNumber}: ${allEmails.length}/${totalEmails} emails`);
  }

  // Group emails into threads
  const threads = groupEmailsIntoThreads(allEmails);
  console.log(`Found ${threads.size} threads`);

  // Process threads in batches to avoid holding too many DB connections
  const threadEntries = Array.from(threads.entries());
  const THREAD_BATCH_SIZE = 10;

  for (let i = 0; i < threadEntries.length; i += THREAD_BATCH_SIZE) {
    const threadBatch = threadEntries.slice(i, i + THREAD_BATCH_SIZE);

    // Process threads in this batch concurrently (but limited batch size)
    await Promise.all(
      threadBatch.map(async ([threadId, emails]) => {
        try {
          stats.threadsProcessed++;
          await processThread(threadId, emails, stats);
        } catch (error: any) {
          console.error(`Error processing thread ${threadId}:`, error);
          stats.errors.push(`Thread ${threadId}: ${error.message}`);
        }
      })
    );

    console.log(`  Processed ${Math.min(i + THREAD_BATCH_SIZE, threadEntries.length)}/${threadEntries.length} threads...`);
  }

  return stats;
}

/**
 * Process a single thread - check if exists, classify if needed, save to DB.
 */
async function processThread(
  threadId: string,
  emails: Email[],
  stats: ProcessStats
): Promise<void> {
  // Check if thread already exists
  const existingThread = await db
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.threadId, threadId))
    .limit(1);

  // Get the latest email date
  const sortedEmails = [...emails].sort((a, b) => {
    const dateA = a.date?.getTime() || 0;
    const dateB = b.date?.getTime() || 0;
    return dateB - dateA;
  });
  const latestEmail = sortedEmails[0];
  const earliestEmail = sortedEmails[sortedEmails.length - 1];

  // Check if we need to reclassify
  const needsClassification =
    !existingThread[0] ||
    !existingThread[0].classifiedAt ||
    (latestEmail.date &&
      existingThread[0].classifiedAt &&
      latestEmail.date > existingThread[0].classifiedAt);

  let status: ThreadStatus = (existingThread[0]?.status as ThreadStatus) || "action_needed";
  let statusReason = existingThread[0]?.statusReason || "";
  let customerName = existingThread[0]?.customerName || null;

  if (needsClassification) {
    // Prepare emails for classification
    const preparedEmails = prepareEmailsForClassification(emails, OUR_EMAIL);

    // Classify thread with AI
    console.log(`    Classifying: ${normalizeSubject(latestEmail.subject)}`);
    const classification = await classifyThread(preparedEmails);
    stats.classificationsRun++;

    status = classification.status;
    statusReason = classification.reason;
    customerName = classification.customerName || customerName;
  }

  // Identify customer if not already set
  const customer = identifyCustomer(emails, OUR_DOMAIN);
  if (!customerName) {
    customerName = customer?.name || null;
  }

  if (existingThread[0]) {
    // Update existing thread
    await db
      .update(schema.threads)
      .set({
        customerName,
        customerEmail: customer?.email || existingThread[0].customerEmail,
        subject: normalizeSubject(latestEmail.subject),
        status,
        statusReason,
        emailCount: emails.length,
        lastActivity: latestEmail.date,
        classifiedAt: needsClassification ? new Date() : existingThread[0].classifiedAt,
      })
      .where(eq(schema.threads.id, existingThread[0].id));

    stats.threadsUpdated++;

    // Update thread_emails links - batch insert
    await db
      .delete(schema.threadEmails)
      .where(eq(schema.threadEmails.threadId, existingThread[0].id));

    if (emails.length > 0) {
      await db.insert(schema.threadEmails).values(
        emails.map((email) => ({
          threadId: existingThread[0].id,
          emailId: email.id,
        }))
      );
    }
  } else {
    // Create new thread
    const newThread: NewThread = {
      threadId,
      customerEmail: customer?.email || null,
      customerName,
      subject: normalizeSubject(latestEmail.subject),
      status,
      statusReason,
      emailCount: emails.length,
      lastActivity: latestEmail.date,
      createdAt: earliestEmail.date || new Date(),
      classifiedAt: new Date(),
    };

    const result = await db
      .insert(schema.threads)
      .values(newThread)
      .returning({ id: schema.threads.id });

    const newThreadId = result[0].id;

    // Create thread_emails links - batch insert
    if (emails.length > 0) {
      await db.insert(schema.threadEmails).values(
        emails.map((email) => ({
          threadId: newThreadId,
          emailId: email.id,
        }))
      );
    }

    stats.threadsCreated++;
  }
}
