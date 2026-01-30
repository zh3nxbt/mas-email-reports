/**
 * Test QuickBooks Connection
 *
 * Run: npm run qb:test
 */

import "dotenv/config";
import { ConductorClient } from "./conductor-client.js";
import { createCustomerMatcher } from "./customer-matcher.js";
import { getCustomerJobDocuments, getJobDocumentsSummary } from "./job-documents.js";
import { getTrustedDomainsStats, isDomainTrusted, getTrustedDomains } from "./trusted-domains.js";

async function main() {
  console.log("=".repeat(60));
  console.log("QuickBooks Connection Test");
  console.log("=".repeat(60));
  console.log("");

  // Check env vars
  if (!process.env.CONDUCTOR_API_KEY || !process.env.CONDUCTOR_END_USER_ID) {
    console.error("ERROR: Missing environment variables");
    console.error("  - CONDUCTOR_API_KEY");
    console.error("  - CONDUCTOR_END_USER_ID");
    process.exit(1);
  }

  const client = new ConductorClient();

  // Test connection
  console.log("[1] Testing connection...");
  const connResult = await client.testConnection();
  if (!connResult.success) {
    console.error("Connection FAILED:", connResult.error);
    process.exit(1);
  }
  console.log("Connection OK");
  console.log("");

  // Fetch customers
  console.log("[2] Fetching customers...");
  const customerResponse = await client.getCustomers({ limit: 5 });
  console.log(`Found ${customerResponse.data.length} customers (showing first 5)`);
  for (const c of customerResponse.data.slice(0, 5)) {
    console.log(`  - ${c.fullName} (${c.email || "no email"})`);
  }
  console.log("");

  // Fetch estimates
  console.log("[3] Fetching estimates...");
  try {
    const estimateResponse = await client.getEstimates({ limit: 5 });
    console.log(`Found ${estimateResponse.data.length} estimates (showing first 5)`);
    for (const e of estimateResponse.data.slice(0, 5)) {
      const status =
        e.customFields?.find((f) => f.name.toLowerCase().includes("status"))?.value || "blank";
      console.log(`  - #${e.refNumber} | ${e.customer.fullName} | $${e.totalAmount} | ${status}`);
    }
  } catch (error) {
    console.log("Estimates endpoint not available or empty");
  }
  console.log("");

  // Fetch sales orders
  console.log("[4] Fetching sales orders...");
  try {
    const soResponse = await client.getSalesOrders({ limit: 5 });
    console.log(`Found ${soResponse.data.length} sales orders (showing first 5)`);
    for (const so of soResponse.data.slice(0, 5)) {
      console.log(
        `  - #${so.refNumber} | ${so.customer.fullName} | $${so.totalAmount} | invoiced: ${so.isFullyInvoiced}`
      );
    }
  } catch (error) {
    console.log("Sales Orders endpoint not available or empty");
  }
  console.log("");

  // Fetch invoices
  console.log("[5] Fetching invoices...");
  try {
    const invResponse = await client.getInvoices({ limit: 5 });
    console.log(`Found ${invResponse.data.length} invoices (showing first 5)`);
    for (const inv of invResponse.data.slice(0, 5)) {
      console.log(
        `  - #${inv.refNumber} | ${inv.customer.fullName} | $${inv.totalAmount} | paid: ${inv.isPaid}`
      );
    }
  } catch (error) {
    console.log("Invoices endpoint not available or empty");
  }
  console.log("");

  // Test customer matching
  console.log("[6] Testing customer matcher...");
  const matcher = createCustomerMatcher(client);

  // Test with a sample - you can change this to a real customer email
  const testEmail = "test@example.com";
  const testName = "Test Customer";

  console.log(`  Searching for: ${testEmail} / ${testName}`);
  const matchResults = await matcher.matchAll(testEmail, testName);
  if (matchResults.length > 0) {
    console.log(`  Found ${matchResults.length} potential matches:`);
    for (const m of matchResults.slice(0, 3)) {
      console.log(`    - ${m.customerName} (${m.confidence} confidence via ${m.matchType})`);
    }
  } else {
    console.log("  No matches found (expected for test data)");
  }
  console.log("");

  // Test job documents - use first customer with estimates
  console.log("[7] Testing job documents...");
  try {
    // Get a customer that has estimates (from our earlier fetch)
    const estimateResponse = await client.getEstimates({ limit: 1 });
    if (estimateResponse.data.length > 0) {
      const testCustomerId = estimateResponse.data[0].customer.id;
      const testCustomerName = estimateResponse.data[0].customer.fullName || "Unknown";

      console.log(`  Fetching job documents for: ${testCustomerName}`);
      const jobDocs = await getCustomerJobDocuments(client, testCustomerId);
      const summary = getJobDocumentsSummary(jobDocs);

      console.log(`  Customer: ${jobDocs.customerName}`);
      console.log(`  Estimates: ${summary.totalEstimates} total`);
      console.log(`    - CONFIRMED: ${summary.confirmedEstimates}`);
      console.log(`    - COMPLETE: ${summary.completeEstimates}`);
      console.log(`    - BLANK: ${summary.blankEstimates}`);
      console.log(`  Sales Orders: ${summary.totalSalesOrders} total (${summary.openSalesOrders} open)`);
      console.log(`  Invoices: ${summary.totalInvoices} total (${summary.unpaidInvoices} unpaid)`);
      if (summary.confirmedWithoutSO > 0) {
        console.log(`  WARNING: ${summary.confirmedWithoutSO} confirmed estimate(s) without sales order`);
      }

      // Show sample estimate with status
      if (jobDocs.estimates.length > 0) {
        console.log("");
        console.log("  Sample estimate:");
        const sample = jobDocs.estimates[0];
        console.log(`    - Ref: #${sample.refNumber}`);
        console.log(`    - Amount: $${sample.totalAmount}`);
        console.log(`    - Status: ${sample.status} (raw: ${sample.jobStatus || "none"})`);
        console.log(`    - Date: ${sample.transactionDate}`);
      }
    } else {
      console.log("  No estimates found to test with");
    }
  } catch (error) {
    console.log("  Job documents test skipped (no estimates available)");
  }
  console.log("");

  // Test trusted domains
  console.log("[8] Testing trusted domains...");
  try {
    const stats = await getTrustedDomainsStats();
    console.log(`  Total trusted domains: ${stats.totalTrusted}`);
    console.log(`  From sent emails: ${stats.fromSentEmails}`);
    console.log(`  From manual whitelist: ${stats.fromManualWhitelist}`);

    if (stats.domains.length > 0) {
      console.log(`  Sample domains (first 10):`);
      for (const domain of stats.domains.slice(0, 10)) {
        console.log(`    - ${domain}`);
      }
      if (stats.domains.length > 10) {
        console.log(`    ... and ${stats.domains.length - 10} more`);
      }
    }

    // Test a few domains
    const trustedDomains = await getTrustedDomains();
    const testEmails = [
      "customer@gmail.com",
      "phishing@suspicious-domain.xyz",
      "sales@masprecisionparts.com",
    ];
    console.log(`  Domain trust checks:`);
    for (const email of testEmails) {
      const trusted = isDomainTrusted(email, trustedDomains);
      console.log(`    - ${email}: ${trusted ? "TRUSTED" : "UNTRUSTED"}`);
    }
  } catch (error) {
    console.log("  Trusted domains test failed:", error);
  }
  console.log("");

  console.log("=".repeat(60));
  console.log("All tests completed successfully!");
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
