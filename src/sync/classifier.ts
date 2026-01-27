import Anthropic from "@anthropic-ai/sdk";
import type { Email, ThreadStatus } from "@/db/schema";

const anthropic = new Anthropic();

export interface ClassificationResult {
  status: ThreadStatus;
  reason: string;
  customerName: string | null;
}

interface EmailForClassification {
  from: string;
  to: string;
  date: Date | null;
  subject: string;
  body: string;
  isOutbound: boolean;
}

function formatEmailForPrompt(email: EmailForClassification): string {
  const direction = email.isOutbound ? "[SENT]" : "[RECEIVED]";
  const date = email.date ? email.date.toISOString().split("T")[0] : "unknown";
  return `${direction} ${date}
From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
---
${email.body.slice(0, 1000)}${email.body.length > 1000 ? "..." : ""}
`;
}

export async function classifyThread(
  emails: EmailForClassification[]
): Promise<ClassificationResult> {
  // Sort emails by date (oldest first)
  const sorted = [...emails].sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateA - dateB;
  });

  const threadFormatted = sorted.map(formatEmailForPrompt).join("\n---\n\n");

  const prompt = `You are analyzing an email thread for a precision parts manufacturing company (MAS Precision Parts).
Read the conversation and determine what action (if any) is needed from us.

IMPORTANT: Emails marked [SENT] are from us (MAS Precision Parts). Emails marked [RECEIVED] are from external parties.

KEY RULE: If the FIRST email is [SENT], we initiated the conversation - meaning we're likely buying from a vendor/supplier, NOT dealing with a customer. These should usually be "no_action" unless a vendor needs something from us.

Thread (oldest first):
${threadFormatted}

Based on the conversation, classify this thread:

1. "action_needed" - A CUSTOMER needs a response from us. They asked a question, made a request, or are waiting for information. This includes cases where WE said "we'll get back to you" but haven't yet.

2. "quote_request" - A CUSTOMER is asking US for pricing, a quote, estimate, or RFQ. We need to prepare and send a quote. IMPORTANT: If WE [SENT] a quote request to a vendor/supplier, that's us buying - classify as "no_action".

3. "po_received" - A CUSTOMER has sent US a purchase order. IMPORTANT: If WE [SENT] a PO to a vendor/supplier, that is NOT po_received - that's us buying from them, classify as "no_action".

4. "no_action" - No response needed. Thread is resolved, conversation complete, we're waiting on THEM, or this involves us buying from vendors/suppliers (quote requests we sent, POs we sent, vendor replies).

5. "not_customer" - Not customer-related (newsletter, spam, internal, automated messages, bank notifications).

Respond with JSON only, no markdown:
{"status": "action_needed" | "quote_request" | "po_received" | "no_action" | "not_customer", "reason": "brief explanation", "customer_name": "extracted customer name or company, or null"}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 256,
      system: "You are a JSON-only classifier. Always respond with valid JSON, no explanations or apologies.",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" }  // Prefill to force JSON start
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Parse JSON response (prepend "{" since we used it as prefill)
    const result = JSON.parse("{" + content.text) as {
      status: string;
      reason: string;
      customer_name: string | null;
    };

    // Validate status
    const validStatuses: ThreadStatus[] = [
      "action_needed",
      "quote_request",
      "po_received",
      "no_action",
      "not_customer",
    ];

    if (!validStatuses.includes(result.status as ThreadStatus)) {
      console.warn(`Invalid status from AI: ${result.status}, defaulting to action_needed`);
      return {
        status: "action_needed",
        reason: result.reason || "Classification unclear",
        customerName: result.customer_name,
      };
    }

    return {
      status: result.status as ThreadStatus,
      reason: result.reason,
      customerName: result.customer_name,
    };
  } catch (error) {
    console.error("Classification error:", error);
    // Default to action_needed on error (safer to show than hide)
    return {
      status: "action_needed",
      reason: "Classification failed - needs manual review",
      customerName: null,
    };
  }
}

export function prepareEmailsForClassification(
  emails: Email[],
  ourEmail: string
): EmailForClassification[] {
  const ourDomain = ourEmail.split("@")[1]?.toLowerCase() || "";

  return emails.map((email) => {
    const fromLower = email.fromAddress?.toLowerCase() || "";
    const isOutbound =
      fromLower.includes(ourDomain) || email.mailbox === "Sent" || email.mailbox === "Sent Items";

    return {
      from: email.fromName || email.fromAddress || "Unknown",
      to: email.toAddresses || "",
      date: email.date,
      subject: email.subject || "(no subject)",
      body: email.bodyText || "",
      isOutbound,
    };
  });
}
