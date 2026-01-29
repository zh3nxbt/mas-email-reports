import type { Email } from "@/db/schema";
import { db, schema } from "@/db";
import { or, inArray, sql } from "drizzle-orm";

// Normalize subject by removing Re:, Fwd:, etc.
export function normalizeSubject(subject: string | null): string {
  if (!subject) return "";
  return subject
    .replace(/^(re|fwd?|fw):\s*/gi, "")
    .replace(/^\[.*?\]\s*/g, "") // Remove [tags]
    .trim()
    .toLowerCase();
}

// Generate a thread ID from email headers
export function generateThreadId(
  messageId: string | null,
  inReplyTo: string | null,
  references: string | null,
  subject: string | null
): string {
  // If we have references, use the first one (original message)
  if (references) {
    const refs = references.split(/\s+/).filter(Boolean);
    if (refs.length > 0) {
      return refs[0];
    }
  }

  // If we have in-reply-to, use that
  if (inReplyTo) {
    return inReplyTo;
  }

  // If we have a message ID and it's not a reply, use it
  if (messageId) {
    return messageId;
  }

  // Fall back to normalized subject
  return `subject:${normalizeSubject(subject)}`;
}

// Group emails into threads
export function groupEmailsIntoThreads(emails: Email[]): Map<string, Email[]> {
  const threads = new Map<string, Email[]>();
  const messageIdToThread = new Map<string, string>();

  // First pass: assign thread IDs
  for (const email of emails) {
    const threadId = generateThreadId(
      email.messageId,
      email.inReplyTo,
      email.references,
      email.subject
    );

    // Track message ID to thread mapping
    if (email.messageId) {
      messageIdToThread.set(email.messageId, threadId);
    }

    if (!threads.has(threadId)) {
      threads.set(threadId, []);
    }
    threads.get(threadId)!.push(email);
  }

  // Second pass: merge threads that are related via In-Reply-To
  const mergedThreads = new Map<string, Email[]>();
  const threadMergeMap = new Map<string, string>();

  for (const [threadId, threadEmails] of threads) {
    let targetThreadId = threadId;

    // Check if any email in this thread references another thread
    for (const email of threadEmails) {
      if (email.inReplyTo && messageIdToThread.has(email.inReplyTo)) {
        const relatedThread = messageIdToThread.get(email.inReplyTo)!;
        if (relatedThread !== threadId) {
          // Follow merge chain
          let finalTarget = threadMergeMap.get(relatedThread) || relatedThread;
          while (threadMergeMap.has(finalTarget)) {
            finalTarget = threadMergeMap.get(finalTarget)!;
          }
          targetThreadId = finalTarget;
          break;
        }
      }
    }

    if (targetThreadId !== threadId) {
      threadMergeMap.set(threadId, targetThreadId);
    }

    // Get the final target thread
    let finalTarget = targetThreadId;
    while (threadMergeMap.has(finalTarget)) {
      finalTarget = threadMergeMap.get(finalTarget)!;
    }

    if (!mergedThreads.has(finalTarget)) {
      mergedThreads.set(finalTarget, []);
    }
    mergedThreads.get(finalTarget)!.push(...threadEmails);
  }

  // Third pass: merge threads with same normalized subject
  // This catches replies that have broken In-Reply-To headers
  // BUT we must NOT merge on generic subjects like "RFQ", "PO", "Quote" etc.
  // because different customers can send emails with these generic titles
  const subjectToThread = new Map<string, string>();
  const finalMergedThreads = new Map<string, Email[]>();
  const subjectMergeMap = new Map<string, string>();

  // Generic subjects that should NEVER be used for merging
  // These are common business terms that different customers might use
  const genericSubjects = new Set([
    'rfq', 'po', 'inv', 'quote', 'order', 'inquiry', 'request',
    'quotation', 'estimate', 'invoice', 'purchase order', 'fyi',
    'question', 'help', 'urgent', 'asap', 'follow up', 'followup',
    'checking in', 'update', 'status', 'reminder', 'thanks', 'thank you'
  ]);

  for (const [threadId, threadEmails] of mergedThreads) {
    // Get the normalized subject from the first email
    const firstEmail = threadEmails[0];
    const normSubject = normalizeSubject(firstEmail?.subject);

    // Only merge if subject is specific enough (>10 chars) and NOT a generic term
    // This catches "RE: PO 1049 from MAS" but not "RFQ" or "Quote"
    const isSpecific = normSubject.length > 10 && !genericSubjects.has(normSubject);
    if (normSubject && isSpecific) {
      if (subjectToThread.has(normSubject)) {
        // Merge into existing thread with same subject
        const existingThreadId = subjectToThread.get(normSubject)!;
        subjectMergeMap.set(threadId, existingThreadId);
      } else {
        subjectToThread.set(normSubject, threadId);
      }
    }
  }

  // Apply subject-based merges
  for (const [threadId, threadEmails] of mergedThreads) {
    let finalTarget = threadId;
    while (subjectMergeMap.has(finalTarget)) {
      finalTarget = subjectMergeMap.get(finalTarget)!;
    }

    if (!finalMergedThreads.has(finalTarget)) {
      finalMergedThreads.set(finalTarget, []);
    }
    finalMergedThreads.get(finalTarget)!.push(...threadEmails);
  }

  // Sort emails within each thread by date
  for (const [, threadEmails] of finalMergedThreads) {
    threadEmails.sort((a, b) => {
      const dateA = a.date?.getTime() || 0;
      const dateB = b.date?.getTime() || 0;
      return dateA - dateB;
    });
  }

  return finalMergedThreads;
}

// Fetch full thread history for emails that appear in a time window
// This expands the window emails to include ALL historical emails in those threads
// cutoffDate: if provided, excludes emails after this date (for historical report accuracy)
export async function fetchFullThreadEmails(windowEmails: Email[], cutoffDate?: Date): Promise<Email[]> {
  if (windowEmails.length === 0) {
    return [];
  }

  // Collect all message IDs, inReplyTo, and references from window emails
  const messageIds = new Set<string>();
  const normalizedSubjects = new Set<string>();

  for (const email of windowEmails) {
    if (email.messageId) {
      messageIds.add(email.messageId);
    }
    if (email.inReplyTo) {
      messageIds.add(email.inReplyTo);
    }
    if (email.references) {
      const refs = email.references.split(/\s+/).filter(Boolean);
      for (const ref of refs) {
        messageIds.add(ref);
      }
    }
    // Also track normalized subjects for subject-based matching
    // BUT only for specific subjects, not generic ones like "RFQ", "PO", etc.
    const normSubject = normalizeSubject(email.subject);
    const genericSubjects = new Set([
      'rfq', 'po', 'inv', 'quote', 'order', 'inquiry', 'request',
      'quotation', 'estimate', 'invoice', 'purchase order', 'fyi',
      'question', 'help', 'urgent', 'asap', 'follow up', 'followup',
      'checking in', 'update', 'status', 'reminder', 'thanks', 'thank you'
    ]);
    if (normSubject && normSubject.length > 10 && !genericSubjects.has(normSubject)) {
      normalizedSubjects.add(normSubject);
    }
  }

  if (messageIds.size === 0 && normalizedSubjects.size === 0) {
    return windowEmails;
  }

  // Query database for all related emails
  // We need to find emails where:
  // 1. Their messageId is in our collected IDs (they're referenced)
  // 2. Their inReplyTo is in our collected IDs (they reply to our emails)
  // 3. Their references contain any of our collected IDs
  // 4. They have the same normalized subject (catches broken headers)
  const messageIdArray = Array.from(messageIds);

  // Build conditions for the query
  const conditions: ReturnType<typeof or>[] = [];

  if (messageIdArray.length > 0) {
    // Match by messageId
    conditions.push(inArray(schema.emails.messageId, messageIdArray));
    // Match by inReplyTo
    conditions.push(inArray(schema.emails.inReplyTo, messageIdArray));
    // Match by references (any of our IDs appear in references)
    for (const msgId of messageIdArray) {
      conditions.push(sql`${schema.emails.references} LIKE ${'%' + msgId + '%'}`);
    }
  }

  // Query with all conditions
  let relatedEmails: Email[] = [];
  if (conditions.length > 0) {
    relatedEmails = await db
      .select()
      .from(schema.emails)
      .where(or(...conditions));
  }

  // Combine window emails with related emails, deduplicate by id
  const emailMap = new Map<number, Email>();
  for (const email of windowEmails) {
    emailMap.set(email.id, email);
  }
  for (const email of relatedEmails) {
    emailMap.set(email.id, email);
  }

  // Now we have all directly related emails, but we need to iterate
  // to find emails that reference the newly found emails (transitive closure)
  // For efficiency, we'll do one more pass

  // Collect any new message IDs from related emails
  const newMessageIds = new Set<string>();
  for (const email of relatedEmails) {
    if (email.messageId && !messageIds.has(email.messageId)) {
      newMessageIds.add(email.messageId);
    }
    if (email.inReplyTo && !messageIds.has(email.inReplyTo)) {
      newMessageIds.add(email.inReplyTo);
    }
    if (email.references) {
      const refs = email.references.split(/\s+/).filter(Boolean);
      for (const ref of refs) {
        if (!messageIds.has(ref)) {
          newMessageIds.add(ref);
        }
      }
    }
  }

  // Second pass to catch any missed emails
  if (newMessageIds.size > 0) {
    const newMessageIdArray = Array.from(newMessageIds);
    const secondPassConditions: ReturnType<typeof or>[] = [];

    secondPassConditions.push(inArray(schema.emails.messageId, newMessageIdArray));
    secondPassConditions.push(inArray(schema.emails.inReplyTo, newMessageIdArray));
    for (const msgId of newMessageIdArray) {
      secondPassConditions.push(sql`${schema.emails.references} LIKE ${'%' + msgId + '%'}`);
    }

    const moreEmails = await db
      .select()
      .from(schema.emails)
      .where(or(...secondPassConditions));

    for (const email of moreEmails) {
      emailMap.set(email.id, email);
    }
  }

  // Also fetch by normalized subject (third pass)
  // This catches emails with broken headers but same subject
  if (normalizedSubjects.size > 0) {
    // Get all emails and filter by normalized subject in JS
    // (SQL LOWER and pattern matching is less efficient)
    const allEmails = await db.select().from(schema.emails);
    for (const email of allEmails) {
      const normSubject = normalizeSubject(email.subject);
      if (normSubject && normalizedSubjects.has(normSubject)) {
        emailMap.set(email.id, email);
      }
    }
  }

  let result = Array.from(emailMap.values());

  // Apply cutoff date filter if provided (excludes emails after the cutoff)
  if (cutoffDate) {
    const beforeFilter = result.length;
    result = result.filter(email => !email.date || email.date <= cutoffDate);
    if (result.length < beforeFilter) {
      console.log(`  Filtered ${beforeFilter - result.length} emails after cutoff ${cutoffDate.toISOString()}`);
    }
  }

  console.log(`Expanded ${windowEmails.length} window emails to ${result.length} full thread emails`);
  return result;
}

// Identify the customer for a thread
export function identifyCustomer(
  emails: Email[],
  ourDomain: string
): { name: string; email: string } | null {
  const ourDomainLower = ourDomain.toLowerCase();

  for (const email of emails) {
    // Check if this is an inbound email (from external address)
    if (
      (email.mailbox === "INBOX") &&
      email.fromAddress
    ) {
      const fromEmail = email.fromAddress.toLowerCase();
      if (!fromEmail.includes(ourDomainLower)) {
        return {
          name: email.fromName || email.fromAddress,
          email: email.fromAddress,
        };
      }
    }

    // Check outbound emails for customer in To field
    if (
      (email.mailbox === "Sent" || email.mailbox === "Sent Items") &&
      email.toAddresses
    ) {
      try {
        const toList = JSON.parse(email.toAddresses) as string[];
        for (const to of toList) {
          if (!to.toLowerCase().includes(ourDomainLower)) {
            return { name: to, email: to };
          }
        }
      } catch {
        // If not JSON, try parsing as comma-separated
        const toList = email.toAddresses.split(",").map((s) => s.trim());
        for (const to of toList) {
          if (!to.toLowerCase().includes(ourDomainLower)) {
            return { name: to, email: to };
          }
        }
      }
    }
  }

  return null;
}
