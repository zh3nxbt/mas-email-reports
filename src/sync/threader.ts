import type { Email } from "@/db/schema";

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

  // Sort emails within each thread by date
  for (const [, threadEmails] of mergedThreads) {
    threadEmails.sort((a, b) => {
      const dateA = a.date?.getTime() || 0;
      const dateB = b.date?.getTime() || 0;
      return dateA - dateB;
    });
  }

  return mergedThreads;
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
