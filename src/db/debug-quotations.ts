import "dotenv/config";
import { db, schema } from "@/db";
import { eq, like } from "drizzle-orm";

async function main() {
  // Get quotation attachments
  const attachments = await db.select().from(schema.poAttachments);
  const quotations = attachments.filter(a =>
    a.filename.toLowerCase().includes("quotation") ||
    a.filename.toLowerCase().includes("invoice") ||
    a.filename.toLowerCase().includes("packing slip") ||
    a.filename.toLowerCase().includes("est_")
  );

  console.log("=== Suspicious files (quotations/invoices WE sent) ===\n");

  for (const att of quotations) {
    console.log(`File: ${att.filename}`);
    console.log(`  ID: ${att.id}`);
    console.log(`  ThreadKey: ${att.threadKey}`);

    // Check report_threads
    const threads = await db
      .select()
      .from(schema.reportThreads)
      .where(eq(schema.reportThreads.threadKey, att.threadKey));

    if (threads.length > 0) {
      console.log(`  In report_threads:`);
      for (const t of threads) {
        console.log(`    - itemType: ${t.itemType}, category: ${t.category}, subject: ${t.subject?.slice(0, 50)}`);
      }
    }

    // Check qb_sync_alerts
    const alerts = await db
      .select()
      .from(schema.qbSyncAlerts)
      .where(eq(schema.qbSyncAlerts.threadKey, att.threadKey));

    if (alerts.length > 0) {
      console.log(`  In qb_sync_alerts:`);
      for (const a of alerts) {
        console.log(`    - alertType: ${a.alertType}, subject: ${a.subject?.slice(0, 50)}`);
      }
    }

    console.log("");
  }

  process.exit(0);
}

main();
