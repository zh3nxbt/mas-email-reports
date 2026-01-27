import { pgTable, text, integer, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const emails = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  messageId: text("message_id"),
  fromAddress: text("from_address"),
  fromName: text("from_name"),
  toAddresses: text("to_addresses"), // JSON array
  subject: text("subject"),
  bodyText: text("body_text"),
  date: timestamp("date"),
  inReplyTo: text("in_reply_to"),
  references: text("references"), // Space-separated message IDs
  mailbox: text("mailbox").notNull(), // INBOX, Sent, Sent Items
  hasAttachments: boolean("has_attachments").default(false),
  attachments: text("attachments"), // JSON array of attachment info
  syncedAt: timestamp("synced_at").notNull(),
});

export const threads = pgTable("email_threads", {
  id: serial("id").primaryKey(),
  threadId: text("thread_id").notNull().unique(), // From email headers or generated
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  subject: text("subject"), // Normalized subject
  status: text("status", {
    enum: ["action_needed", "quote_request", "po_received", "no_action", "not_customer"],
  }).notNull().default("action_needed"),
  statusReason: text("status_reason"), // AI's explanation
  emailCount: integer("email_count").notNull().default(0),
  lastActivity: timestamp("last_activity"),
  createdAt: timestamp("created_at").notNull(),
  classifiedAt: timestamp("classified_at"),
});

export const threadEmails = pgTable("email_thread_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  emailId: integer("email_id")
    .notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
});

// Type exports
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type ThreadEmail = typeof threadEmails.$inferSelect;
export type NewThreadEmail = typeof threadEmails.$inferInsert;
export type ThreadStatus = "action_needed" | "quote_request" | "po_received" | "no_action" | "not_customer";
