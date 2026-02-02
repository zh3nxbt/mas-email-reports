import "dotenv/config";
import { db, schema } from "@/db";
import { min, max, count } from "drizzle-orm";

async function check() {
  // Check sync metadata
  const syncMeta = await db.select().from(schema.syncMetadata);
  console.log("=== Sync Metadata ===");
  for (const m of syncMeta) {
    console.log(`  ${m.mailbox}: last sync ${m.lastSyncAt}`);
  }

  // Check email counts by mailbox
  const counts = await db
    .select({
      mailbox: schema.emails.mailbox,
      count: count(),
      earliest: min(schema.emails.date),
      latest: max(schema.emails.date),
    })
    .from(schema.emails)
    .groupBy(schema.emails.mailbox);

  console.log("\n=== Email Counts by Mailbox ===");
  for (const c of counts) {
    console.log(`  ${c.mailbox}: ${c.count} emails`);
    console.log(`    earliest: ${c.earliest}`);
    console.log(`    latest: ${c.latest}`);
  }

  // Check total
  const total = await db.select({ count: count() }).from(schema.emails);
  console.log(`\nTotal emails: ${total[0].count}`);

  process.exit(0);
}

check();
