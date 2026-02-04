import "dotenv/config";
import { db, schema } from "@/db";
import { sql, desc } from "drizzle-orm";
import { groupEmailsIntoThreads } from "@/sync/threader";
import { categorizeThreadWithAI } from "./summarizer";
import type { Category, Email } from "@/db/schema";
import type { EmailForPrompt } from "./types";

const OUR_DOMAIN = process.env.IMAP_USER?.split("@")[1]?.toLowerCase() || "masprecisionparts.com";

function isFromUs(email: Email): boolean {
  return (
    email.fromAddress?.toLowerCase().includes(OUR_DOMAIN) ||
    email.mailbox === "Sent" ||
    email.mailbox === "Sent Messages"
  );
}

function toEmailForPrompt(email: Email): EmailForPrompt {
  return {
    from: email.fromAddress || "",
    to: email.toAddresses || "",
    date: email.date,
    subject: email.subject || "",
    body: email.bodyText || "",
    isOutbound: isFromUs(email),
    hasAttachments: email.hasAttachments || false,
  };
}

async function analyzeThread(threadKey: string, emails: Email[]) {
  console.log("\n=== Analyzing Thread ===\n");

  // Sort by date
  emails.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  // Determine initial category
  const firstEmail = emails[0];
  const initialCategory: Category = isFromUs(firstEmail) ? "vendor" : "customer";

  // Format for display
  const formatted = emails
    .map((e) => {
      const dir = isFromUs(e) ? "[SENT]" : "[RECEIVED]";
      const date = e.date?.toLocaleString("en-US", { timeZone: "America/New_York" }) || "unknown";
      return `${dir} ${date}\nFrom: ${e.fromAddress}\nSubject: ${e.subject}\n\n${e.bodyText?.slice(0, 800) || "(no body)"}`;
    })
    .join("\n---\n");

  console.log("Thread content preview:");
  console.log(formatted.slice(0, 1500) + (formatted.length > 1500 ? "\n...(truncated)" : ""));
  console.log("\n=== AI Analysis ===\n");

  // Convert to EmailForPrompt format
  const emailsForPrompt = emails.map(toEmailForPrompt);

  const result = await categorizeThreadWithAI(emailsForPrompt, initialCategory);

  console.log("Category:", result.category);
  console.log("Item Type:", result.itemType);
  console.log("Contact:", result.contactName);
  console.log("Needs Response:", result.needsResponse);
  console.log("Summary:", result.summary);

  return result;
}

async function main() {
  const searchTerm = process.argv[2];

  if (!searchTerm) {
    console.log("Usage: npx tsx src/report/reanalyze-thread.ts <search-term>");
    console.log('Example: npx tsx src/report/reanalyze-thread.ts "McMaster"');
    process.exit(1);
  }

  console.log(`Searching for threads matching: "${searchTerm}"\n`);

  // Find emails matching the search term
  const emails = await db
    .select()
    .from(schema.emails)
    .where(sql`${schema.emails.subject} ILIKE ${"%" + searchTerm + "%"}`)
    .orderBy(desc(schema.emails.date));

  if (emails.length === 0) {
    console.log("No emails found matching that term.");
    process.exit(1);
  }

  console.log(`Found ${emails.length} emails. Grouping into threads...\n`);

  // Group into threads
  const threadMap = groupEmailsIntoThreads(emails);

  // Show threads and let user pick
  const threads = Array.from(threadMap.entries());
  console.log(`Found ${threads.length} thread(s):\n`);

  threads.forEach(([, threadEmails], idx) => {
    const latest = threadEmails[threadEmails.length - 1];
    const latestDate = latest.date?.toLocaleString("en-US", { timeZone: "America/New_York" });
    console.log(`[${idx + 1}] ${latest.subject}`);
    console.log(`    Last: ${latestDate} | Emails: ${threadEmails.length}`);
    console.log(`    From: ${latest.fromAddress}\n`);
  });

  // If only one thread, analyze it directly
  if (threads.length === 1) {
    await analyzeThread(threads[0][0], threads[0][1]);
  } else {
    console.log("Multiple threads found. Analyzing the most recent one...\n");
    // Analyze the first (most recent) thread
    await analyzeThread(threads[0][0], threads[0][1]);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
