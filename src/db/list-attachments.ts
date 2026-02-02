import "dotenv/config";
import { db, schema } from "@/db";

async function main() {
  const rows = await db.select().from(schema.poAttachments);

  console.log("=== All attachments in email_po_attachments ===\n");
  for (const r of rows) {
    console.log(`${r.id} | ${r.filename} | PO: ${r.poNumber || "(none)"}`);
  }
  console.log(`\nTotal: ${rows.length}`);

  // Check for quotations specifically
  const quotations = rows.filter(r => r.filename.toLowerCase().includes("quotation") || r.filename.toLowerCase().includes("quote"));
  if (quotations.length > 0) {
    console.log("\n=== Quotation files found ===");
    for (const q of quotations) {
      console.log(`  ${q.id} | ${q.filename} | threadKey: ${q.threadKey.slice(0, 50)}...`);
    }
  }

  process.exit(0);
}

main();
