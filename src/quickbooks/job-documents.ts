/**
 * Job Documents Organizer
 *
 * Provides a unified view of customer job documents (Estimates, Sales Orders, Invoices)
 * to trace the job lifecycle:
 *   Email PO received → Sales Order exists? → If not, flag Estimate → Eventually Invoiced?
 */

import type { ConductorClient } from "./conductor-client.js";
import type { QBEstimate, QBSalesOrder, QBInvoice, ParsedEstimate } from "./types.js";

// ============================================================
// Types
// ============================================================

export interface CustomerJobDocuments {
  customerId: string;
  customerName: string;
  estimates: ParsedEstimate[];
  salesOrders: QBSalesOrder[];
  invoices: QBInvoice[];
}

export interface GetJobDocumentsOptions {
  /** Only fetch documents updated after this date */
  since?: Date;
  /** Include fully invoiced sales orders (default: false) */
  includeFullyInvoiced?: boolean;
  /** Include paid invoices (default: true) */
  includePaidInvoices?: boolean;
}

// ============================================================
// Estimate Status Parsing
// ============================================================

/**
 * Parse the custom field status from a QB estimate
 *
 * MAS uses a custom field to track estimate status:
 * - CONFIRMED: Customer confirmed, ready to produce
 * - COMPLETE: Job finished
 * - blank: Pending/not yet confirmed
 *
 * NOTE: This estimate status tracking will become OBSOLETE if we have
 * full sales order functionality. The proper workflow would be:
 *   Estimate → Sales Order (confirms job) → Invoice (completes job)
 * At that point, estimate status can be inferred from whether a
 * corresponding Sales Order exists, rather than relying on custom fields.
 */
export function parseEstimateStatus(estimate: QBEstimate): ParsedEstimate {
  const statusField = estimate.customFields?.find((f) =>
    f.name.toLowerCase().includes("status")
  );
  const rawStatus = statusField?.value?.toUpperCase()?.trim();

  let status: ParsedEstimate["status"] = "BLANK";
  if (rawStatus === "CONFIRMED") {
    status = "CONFIRMED";
  } else if (rawStatus === "COMPLETE") {
    status = "COMPLETE";
  }

  return {
    ...estimate,
    status,
    jobStatus: statusField?.value || undefined,
  };
}

/**
 * Parse status for multiple estimates
 */
export function parseEstimatesStatus(estimates: QBEstimate[]): ParsedEstimate[] {
  return estimates.map(parseEstimateStatus);
}

// ============================================================
// Main Function
// ============================================================

/**
 * Get all job-related documents for a customer
 *
 * Fetches estimates, sales orders, and invoices in parallel
 * and returns them in a unified structure for job tracking.
 */
export async function getCustomerJobDocuments(
  client: ConductorClient,
  customerId: string,
  options: GetJobDocumentsOptions = {}
): Promise<CustomerJobDocuments> {
  const { since, includeFullyInvoiced = false, includePaidInvoices = true } = options;

  // Format date for API if provided
  const updatedAfter = since?.toISOString();

  // Fetch all document types in parallel
  const [estimates, salesOrders, invoices, customer] = await Promise.all([
    client.getEstimatesForCustomer(customerId, { updatedAfter }),
    client.getSalesOrdersForCustomer(customerId, {
      updatedAfter,
      includeFullyInvoiced,
    }),
    client.getInvoicesForCustomer(customerId, {
      updatedAfter,
      unpaidOnly: !includePaidInvoices,
    }),
    client.getCustomer(customerId),
  ]);

  // Parse estimate statuses
  const parsedEstimates = parseEstimatesStatus(estimates);

  return {
    customerId,
    customerName: customer.fullName || customer.name,
    estimates: parsedEstimates,
    salesOrders,
    invoices,
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Filter estimates by status
 */
export function filterEstimatesByStatus(
  estimates: ParsedEstimate[],
  status: ParsedEstimate["status"]
): ParsedEstimate[] {
  return estimates.filter((e) => e.status === status);
}

/**
 * Get estimates that are confirmed but don't have a corresponding sales order
 *
 * This helps identify jobs that were confirmed but haven't been
 * converted to sales orders yet (potential oversight).
 */
export function getConfirmedEstimatesWithoutSalesOrders(
  docs: CustomerJobDocuments
): ParsedEstimate[] {
  const confirmedEstimates = filterEstimatesByStatus(docs.estimates, "CONFIRMED");

  // For each confirmed estimate, check if there's a matching sales order
  // Match by ref number or by similar amount (heuristic)
  return confirmedEstimates.filter((estimate) => {
    const hasMatchingSO = docs.salesOrders.some((so) => {
      // Try to match by ref number
      if (
        estimate.refNumber &&
        so.refNumber &&
        so.refNumber.includes(estimate.refNumber)
      ) {
        return true;
      }
      // Try to match by amount (same customer, same amount = likely same job)
      if (
        estimate.totalAmount &&
        so.totalAmount &&
        estimate.totalAmount === so.totalAmount
      ) {
        return true;
      }
      return false;
    });
    return !hasMatchingSO;
  });
}

/**
 * Get open sales orders (not fully invoiced)
 */
export function getOpenSalesOrders(docs: CustomerJobDocuments): QBSalesOrder[] {
  return docs.salesOrders.filter((so) => !so.isFullyInvoiced && !so.isManuallyClosed);
}

/**
 * Get unpaid invoices
 */
export function getUnpaidInvoices(docs: CustomerJobDocuments): QBInvoice[] {
  return docs.invoices.filter((inv) => !inv.isPaid);
}

/**
 * Summary statistics for a customer's job documents
 */
export interface JobDocumentsSummary {
  totalEstimates: number;
  confirmedEstimates: number;
  blankEstimates: number;
  completeEstimates: number;
  totalSalesOrders: number;
  openSalesOrders: number;
  totalInvoices: number;
  unpaidInvoices: number;
  confirmedWithoutSO: number;
}

/**
 * Get summary statistics for customer job documents
 */
export function getJobDocumentsSummary(docs: CustomerJobDocuments): JobDocumentsSummary {
  return {
    totalEstimates: docs.estimates.length,
    confirmedEstimates: filterEstimatesByStatus(docs.estimates, "CONFIRMED").length,
    blankEstimates: filterEstimatesByStatus(docs.estimates, "BLANK").length,
    completeEstimates: filterEstimatesByStatus(docs.estimates, "COMPLETE").length,
    totalSalesOrders: docs.salesOrders.length,
    openSalesOrders: getOpenSalesOrders(docs).length,
    totalInvoices: docs.invoices.length,
    unpaidInvoices: getUnpaidInvoices(docs).length,
    confirmedWithoutSO: getConfirmedEstimatesWithoutSalesOrders(docs).length,
  };
}
