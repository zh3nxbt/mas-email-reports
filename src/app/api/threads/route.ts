import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray, desc, sql, count } from "drizzle-orm";
import type { ThreadStatus } from "@/db/schema";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10))
    );
    const offset = (page - 1) * limit;

    // Build base query conditions
    const statusFilter = status
      ? inArray(schema.threads.status, status.split(",") as ThreadStatus[])
      : undefined;

    // Get total count for pagination
    const countResult = await db
      .select({ total: count() })
      .from(schema.threads)
      .where(statusFilter);
    const total = countResult[0]?.total || 0;

    // Fetch threads with pagination
    const threads = statusFilter
      ? await db
          .select()
          .from(schema.threads)
          .where(statusFilter)
          .orderBy(desc(schema.threads.lastActivity))
          .limit(limit)
          .offset(offset)
      : await db
          .select()
          .from(schema.threads)
          .orderBy(desc(schema.threads.lastActivity))
          .limit(limit)
          .offset(offset);

    if (threads.length === 0) {
      return NextResponse.json({
        threads: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    // Get all thread IDs
    const threadIds = threads.map((t) => t.id);

    // Batch fetch all thread-email links for these threads (single query)
    const allThreadEmailLinks = await db
      .select({
        threadId: schema.threadEmails.threadId,
        emailId: schema.threadEmails.emailId,
      })
      .from(schema.threadEmails)
      .where(inArray(schema.threadEmails.threadId, threadIds));

    // Get all unique email IDs
    const allEmailIds = [...new Set(allThreadEmailLinks.map((te) => te.emailId))];

    // Batch fetch all emails we need (single query)
    const allEmails =
      allEmailIds.length > 0
        ? await db
            .select({
              id: schema.emails.id,
              bodyText: schema.emails.bodyText,
              date: schema.emails.date,
            })
            .from(schema.emails)
            .where(inArray(schema.emails.id, allEmailIds))
        : [];

    // Create lookup maps for O(1) access
    const emailMap = new Map(allEmails.map((e) => [e.id, e]));
    const threadEmailsMap = new Map<number, number[]>();
    for (const link of allThreadEmailLinks) {
      const existing = threadEmailsMap.get(link.threadId) || [];
      existing.push(link.emailId);
      threadEmailsMap.set(link.threadId, existing);
    }

    // Build response with previews (no additional queries)
    const threadsWithDetails = threads.map((thread) => {
      const emailIds = threadEmailsMap.get(thread.id) || [];
      let latestEmailPreview = "";

      if (emailIds.length > 0) {
        // Find the latest email for this thread
        const threadEmails = emailIds
          .map((id) => emailMap.get(id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined)
          .sort((a, b) => {
            const dateA = a.date?.getTime() || 0;
            const dateB = b.date?.getTime() || 0;
            return dateB - dateA;
          });

        if (threadEmails[0]?.bodyText) {
          latestEmailPreview = threadEmails[0].bodyText.slice(0, 150) + "...";
        }
      }

      return {
        ...thread,
        latestEmailPreview,
      };
    });

    return NextResponse.json({
      threads: threadsWithDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching threads:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch threads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
