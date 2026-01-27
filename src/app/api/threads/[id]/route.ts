import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const threadId = parseInt(id, 10);

    if (isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
    }

    // Get thread
    const threads = await db
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId));

    const thread = threads[0];

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Get email IDs in this thread
    const threadEmailLinks = await db
      .select()
      .from(schema.threadEmails)
      .where(eq(schema.threadEmails.threadId, threadId));

    const emailIds = threadEmailLinks.map((te) => te.emailId);

    // Fetch all emails in one query using inArray
    const emails =
      emailIds.length > 0
        ? await db
            .select()
            .from(schema.emails)
            .where(inArray(schema.emails.id, emailIds))
        : [];

    // Sort by date
    emails.sort((a, b) => {
      const dateA = a.date?.getTime() || 0;
      const dateB = b.date?.getTime() || 0;
      return dateA - dateB;
    });

    return NextResponse.json({ thread, emails });
  } catch (error) {
    console.error("Error fetching thread:", error);
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const threadId = parseInt(id, 10);

    if (isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
    }

    const body = await request.json();
    const { status } = body;

    const validStatuses = [
      "action_needed",
      "quote_request",
      "po_received",
      "no_action",
      "not_customer",
    ];

    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await db
      .update(schema.threads)
      .set({
        status,
        statusReason: "Manually updated by user",
        classifiedAt: new Date(),
      })
      .where(eq(schema.threads.id, threadId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating thread:", error);
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 }
    );
  }
}
