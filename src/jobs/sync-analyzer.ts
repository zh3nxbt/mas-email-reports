/**
 * Sync Analyzer for QuickBooks Job Sync (Phase 4)
 *
 * Compares email-detected POs with QuickBooks data to identify sync discrepancies.
 * Uses trusted domain filtering to skip suspicious/phishing emails before
 * analyzing PDFs or matching to QB customers.
 *
 * NOTE: This is a placeholder implementation. The full logic will be added
 * when Phase 4 is implemented. Currently demonstrates trusted domain filtering.
 */

import type { CategorizedThread } from "../report/types.js";
import { getExternalContact } from "../report/categorizer.js";
import {
  getTrustedDomains,
  isDomainTrusted,
  getTrustedDomainsStats,
} from "../quickbooks/trusted-domains.js";

export interface SyncAlert {
  type:
    | "po_has_so" // PO received, matching Sales Order found (all good)
    | "po_no_so_has_estimate" // PO received, no SO but found matching estimate
    | "po_no_so_no_estimate" // PO received, no SO and no matching estimate
    | "job_not_invoiced" // Sales Order complete but no invoice
    | "suspicious_po_email"; // PO email from untrusted domain (potential phishing)
  customer: { email: string; name: string | null; qbId?: string };
  poThread?: CategorizedThread;
  suggestedAction: string;
}

export interface AnalyzeResult {
  processed: CategorizedThread[];
  alerts: SyncAlert[];
}

/**
 * Analyze PO threads and compare with QuickBooks data
 *
 * @param poReceivedThreads - Threads categorized as po_received
 * @returns Analysis results including discrepancies found
 */
export async function analyzePoThreads(
  poReceivedThreads: CategorizedThread[]
): Promise<AnalyzeResult> {
  const result: AnalyzeResult = {
    processed: [],
    alerts: [],
  };

  if (poReceivedThreads.length === 0) {
    return result;
  }

  // Load trusted domains once for all threads
  const trustedDomains = await getTrustedDomains();
  const stats = await getTrustedDomainsStats();
  console.log(
    `Trusted domains: ${stats.totalTrusted} (${stats.fromSentEmails} from sent emails, ${stats.fromManualWhitelist} from whitelist)`
  );

  for (const thread of poReceivedThreads) {
    // Get the external contact (customer who sent the PO)
    const contact = getExternalContact(thread.emails);

    if (!contact.email) {
      // No contact email - flag as suspicious
      result.alerts.push({
        type: "suspicious_po_email",
        customer: { email: "unknown", name: contact.name },
        poThread: thread,
        suggestedAction: "Review manually - no sender email found",
      });
      console.log(
        `Flagged thread "${thread.subject?.slice(0, 40)}...": no contact email`
      );
      continue;
    }

    // Check if domain is trusted before processing
    if (!isDomainTrusted(contact.email, trustedDomains)) {
      const domain = contact.email.split("@")[1];
      result.alerts.push({
        type: "suspicious_po_email",
        customer: { email: contact.email, name: contact.name },
        poThread: thread,
        suggestedAction: `Review manually - domain "${domain}" not in trusted list (may be phishing or new customer)`,
      });
      console.log(`Flagged untrusted domain: ${contact.email}`);
      continue;
    }

    // Domain is trusted - safe to proceed with PDF analysis and QB matching
    result.processed.push(thread);
    console.log(`Processing trusted thread from: ${contact.email}`);

    // TODO (Phase 4): Implement full sync logic here:
    // 1. Extract PO details from PDF attachments using pdf-extractor
    // 2. Match email contact to QB customer using customer-matcher
    // 3. Fetch job documents for matched customer
    // 4. Check if matching Sales Order exists → po_has_so (all good)
    // 5. If no SO, check for matching Estimate → po_no_so_has_estimate
    // 6. If neither → po_no_so_no_estimate
    // 7. Add alerts to result.alerts
  }

  return result;
}

/**
 * Filter threads to only those from trusted domains
 * Useful for pre-filtering before more expensive operations
 */
export async function filterTrustedThreads(
  threads: CategorizedThread[]
): Promise<{
  trusted: CategorizedThread[];
  untrusted: CategorizedThread[];
}> {
  const trustedDomains = await getTrustedDomains();

  const trusted: CategorizedThread[] = [];
  const untrusted: CategorizedThread[] = [];

  for (const thread of threads) {
    const contact = getExternalContact(thread.emails);

    if (contact.email && isDomainTrusted(contact.email, trustedDomains)) {
      trusted.push(thread);
    } else {
      untrusted.push(thread);
    }
  }

  return { trusted, untrusted };
}

/**
 * Print trusted domain statistics for debugging
 */
export async function printTrustedDomainStats(): Promise<void> {
  const stats = await getTrustedDomainsStats();

  console.log("\n=== Trusted Domains ===");
  console.log(`Total: ${stats.totalTrusted}`);
  console.log(`From sent emails: ${stats.fromSentEmails}`);
  console.log(`From manual whitelist: ${stats.fromManualWhitelist}`);
  console.log("\nDomains:");
  for (const domain of stats.domains) {
    console.log(`  - ${domain}`);
  }
  console.log("");
}
