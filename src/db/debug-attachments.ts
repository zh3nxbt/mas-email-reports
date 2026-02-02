import "dotenv/config";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

async function main() {
  // Get all attachments
  const attachments = await db.select().from(schema.poAttachments);

  console.log("=== Checking each attachment's thread itemType ===\n");

  for (const att of attachments) {
    // Look up the thread in report_threads
    const threads = await db
      .select()
      .from(schema.reportThreads)
      .where(eq(schema.reportThreads.threadKey, att.threadKey));

    const itemTypes = [...new Set(threads.map(t => t.itemType))];
    const categories = [...new Set(threads.map(t => t.category))];

    // Check if in qb_sync_alerts
    const alerts = await db
      .select()
      .from(schema.qbSyncAlerts)
      .where(eq(schema.qbSyncAlerts.threadKey, att.threadKey));

    const isPOReceived = itemTypes.includes("po_received");
    const hasAlert = alerts.length > 0;

    if (!isPOReceived && !hasAlert) {
      console.log(`INVALID: ${att.id} | ${att.filename}`);
      console.log(`  itemTypes: ${itemTypes.join(", ") || "(not in report_threads)"}`);
      console.log(`  categories: ${categories.join(", ") || "(none)"}`);
      console.log(`  in qb_sync_alerts: ${hasAlert}`);
      console.log("");
    }
  }

  // Summary
  const poReceivedThreadKeys = new Set(
    (await db
      .select({ threadKey: schema.reportThreads.threadKey })
      .from(schema.reportThreads)
      .where(eq(schema.reportThreads.itemType, "po_received"))
    ).map(r => r.threadKey)
  );

  const alertThreadKeys = new Set(
    (await db
      .select({ threadKey: schema.qbSyncAlerts.threadKey })
      .from(schema.qbSyncAlerts)
    ).map(r => r.threadKey).filter(Boolean)
  );

  const validThreadKeys = new Set([...poReceivedThreadKeys, ...alertThreadKeys]);

  const invalidCount = attachments.filter(a => !validThreadKeys.has(a.threadKey)).length;
  console.log(`\n=== Summary ===`);
  console.log(`Total attachments: ${attachments.length}`);
  console.log(`Valid (po_received or has alert): ${attachments.length - invalidCount}`);
  console.log(`Invalid: ${invalidCount}`);

  process.exit(0);
}

main();
