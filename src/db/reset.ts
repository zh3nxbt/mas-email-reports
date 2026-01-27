import "dotenv/config";
import { db, schema } from "./index";

async function reset() {
  console.log("Clearing all email data...");

  // Delete in order due to foreign key constraints
  await db.delete(schema.threadEmails);
  console.log("  - Cleared thread_emails");

  await db.delete(schema.threads);
  console.log("  - Cleared threads");

  await db.delete(schema.emails);
  console.log("  - Cleared emails");

  console.log("Done! Run 'npm run sync' to re-sync emails.");
  process.exit(0);
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
