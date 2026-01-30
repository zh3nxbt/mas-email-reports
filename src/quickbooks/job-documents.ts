/**
 * Job Documents Organizer
 *
 * Provides a unified view of customer job documents (Sales Orders, Invoices, Estimates)
 * to trace the job lifecycle:
 *   Email PO received → Sales Order exists? → If not, find matching Estimate → Eventually Invoiced?
 *
 * Sales Orders are the PRIMARY source of truth for confirmed jobs.
 * Estimates are only used as fallback when a PO has no corresponding Sales Order.
 */

import type { ConductorClient } from "./conductor-client.js";
import type { QBEstimate, QBSalesOrder, QBInvoice } from "./types.js";

// ============================================================
// Types
// ============================================================

export interface CustomerJobDocuments {
  customerId: string;
  customerName: string;
  salesOrders: QBSalesOrder[];
  invoices: QBInvoice[];
  estimates: QBEstimate[]; // Fallback only - used when no SO matches a PO
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
// Main Function
// ============================================================

/**
 * Get all job-related documents for a customer
 *
 * Fetches sales orders, invoices, and estimates in parallel.
 * Sales Orders are the primary reference; estimates are fallback only.
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
  const [salesOrders, invoices, estimates, customer] = await Promise.all([
    client.getSalesOrdersForCustomer(customerId, {
      updatedAfter,
      includeFullyInvoiced,
    }),
    client.getInvoicesForCustomer(customerId, {
      updatedAfter,
      unpaidOnly: !includePaidInvoices,
    }),
    client.getEstimatesForCustomer(customerId, { updatedAfter }),
    client.getCustomer(customerId),
  ]);

  return {
    customerId,
    customerName: customer.fullName || customer.name,
    salesOrders,
    invoices,
    estimates,
  };
}

// ============================================================
// Sales Order Helpers (Primary)
// ============================================================

/**
 * Get open sales orders (not fully invoiced, not manually closed)
 */
export function getOpenSalesOrders(docs: CustomerJobDocuments): QBSalesOrder[] {
  return docs.salesOrders.filter((so) => !so.isFullyInvoiced && !so.isManuallyClosed);
}

/**
 * Find a sales order that might match a PO
 * Matches by ref number similarity or amount
 */
export function findMatchingSalesOrder(
  docs: CustomerJobDocuments,
  poNumber?: string,
  poAmount?: number
): QBSalesOrder | null {
  for (const so of docs.salesOrders) {
    // Match by PO number in ref or memo
    if (poNumber) {
      const poNorm = poNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
      const refNorm = (so.refNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const memoNorm = (so.memo || "").toLowerCase().replace(/[^a-z0-9]/g, "");

      if (refNorm.includes(poNorm) || memoNorm.includes(poNorm)) {
        return so;
      }
    }

    // Match by amount (within 5% tolerance)
    if (poAmount && so.totalAmount) {
      const soAmount = parseFloat(so.totalAmount);
      const tolerance = poAmount * 0.05;
      if (Math.abs(soAmount - poAmount) <= tolerance) {
        return so;
      }
    }
  }

  return null;
}

// ============================================================
// Estimate Helpers (Fallback)
// ============================================================

/**
 * Find an estimate that might match a PO (when no Sales Order exists)
 * Only used as fallback - the alert would be "PO received, no SO, found estimate"
 */
export function findMatchingEstimate(
  docs: CustomerJobDocuments,
  poNumber?: string,
  poAmount?: number
): QBEstimate | null {
  for (const est of docs.estimates) {
    // Match by ref number
    if (poNumber) {
      const poNorm = poNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
      const refNorm = (est.refNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const memoNorm = (est.memo || "").toLowerCase().replace(/[^a-z0-9]/g, "");

      if (refNorm.includes(poNorm) || memoNorm.includes(poNorm)) {
        return est;
      }
    }

    // Match by amount (within 5% tolerance)
    if (poAmount && est.totalAmount) {
      const estAmount = parseFloat(est.totalAmount);
      const tolerance = poAmount * 0.05;
      if (Math.abs(estAmount - poAmount) <= tolerance) {
        return est;
      }
    }
  }

  return null;
}

// ============================================================
// Invoice Helpers
// ============================================================

/**
 * Get unpaid invoices
 */
export function getUnpaidInvoices(docs: CustomerJobDocuments): QBInvoice[] {
  return docs.invoices.filter((inv) => !inv.isPaid);
}

// ============================================================
// Summary
// ============================================================

export interface JobDocumentsSummary {
  totalSalesOrders: number;
  openSalesOrders: number;
  totalInvoices: number;
  unpaidInvoices: number;
  totalEstimates: number; // For reference only
}

/**
 * Get summary statistics for customer job documents
 */
export function getJobDocumentsSummary(docs: CustomerJobDocuments): JobDocumentsSummary {
  return {
    totalSalesOrders: docs.salesOrders.length,
    openSalesOrders: getOpenSalesOrders(docs).length,
    totalInvoices: docs.invoices.length,
    unpaidInvoices: getUnpaidInvoices(docs).length,
    totalEstimates: docs.estimates.length,
  };
}
