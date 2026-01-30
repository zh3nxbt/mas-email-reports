/**
 * Conductor.is REST API Client (TypeScript)
 *
 * Wrapper for QuickBooks Desktop API via Conductor
 * Focused on READ operations for job sync/alert system
 */

import type {
  QBCustomer,
  QBEstimate,
  QBSalesOrder,
  QBInvoice,
  QBVendor,
  QBCustomerMatch,
  CustomersResponse,
  EstimatesResponse,
  SalesOrdersResponse,
  InvoicesResponse,
  VendorsResponse,
  CustomerListParams,
  EstimateListParams,
  SalesOrderListParams,
  InvoiceListParams,
  ListParams,
} from "./types.js";

const API_BASE = "https://api.conductor.is/v1";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ConductorClient {
  private apiKey: string;
  private endUserId: string;

  constructor(apiKey?: string, endUserId?: string) {
    this.apiKey = apiKey || process.env.CONDUCTOR_API_KEY || "";
    this.endUserId = endUserId || process.env.CONDUCTOR_END_USER_ID || "";

    if (!this.apiKey || !this.endUserId) {
      throw new Error("Missing CONDUCTOR_API_KEY or CONDUCTOR_END_USER_ID");
    }
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const method = options.method || "GET";

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Conductor-End-User-Id": this.endUserId,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${JSON.stringify(data)}`);
    }

    return data as T;
  }

  private buildQueryString(params: object): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    );
    if (entries.length === 0) return "";
    return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  }

  // ============================================================
  // CUSTOMERS
  // ============================================================

  async getCustomers(params: CustomerListParams = {}): Promise<CustomersResponse> {
    const query = this.buildQueryString(params);
    return this.request<CustomersResponse>(`/quickbooks-desktop/customers${query}`);
  }

  async getCustomer(id: string): Promise<QBCustomer> {
    return this.request<QBCustomer>(`/quickbooks-desktop/customers/${id}`);
  }

  /**
   * Fetch all active customers for matching
   * Returns simplified list for fuzzy matching
   */
  async getCustomerListForMatching(): Promise<QBCustomerMatch[]> {
    const customers: QBCustomerMatch[] = [];
    let cursor: string | undefined = undefined;
    let page = 0;
    const maxPages = 30;

    do {
      const params: CustomerListParams = { limit: 150, status: "active" };
      if (cursor) params.cursor = cursor;

      const response = await this.getCustomers(params);

      if (response.data) {
        for (const c of response.data) {
          customers.push({
            id: c.id,
            name: c.name,
            fullName: c.fullName,
            companyName: c.companyName,
            email: c.email,
            phone: c.phone,
          });
        }
      }

      cursor = response.nextCursor;
      page++;
    } while (cursor && page < maxPages);

    return customers;
  }

  // ============================================================
  // ESTIMATES
  // ============================================================

  async getEstimates(params: EstimateListParams = {}): Promise<EstimatesResponse> {
    const query = this.buildQueryString(params);
    return this.request<EstimatesResponse>(`/quickbooks-desktop/estimates${query}`);
  }

  async getEstimate(id: string): Promise<QBEstimate> {
    return this.request<QBEstimate>(`/quickbooks-desktop/estimates/${id}`);
  }

  /**
   * Get all estimates for a specific customer
   */
  async getEstimatesForCustomer(
    customerId: string,
    options: { updatedAfter?: string } = {}
  ): Promise<QBEstimate[]> {
    const estimates: QBEstimate[] = [];
    let cursor: string | undefined = undefined;
    let page = 0;
    const maxPages = 10;

    do {
      const params: EstimateListParams = {
        limit: 150,
        customerIds: customerId,
      };
      if (options.updatedAfter) params.updatedAfter = options.updatedAfter;
      if (cursor) params.cursor = cursor;

      const response = await this.getEstimates(params);
      if (response.data) {
        estimates.push(...response.data);
      }

      cursor = response.nextCursor;
      page++;
    } while (cursor && page < maxPages);

    return estimates;
  }

  // ============================================================
  // SALES ORDERS
  // ============================================================

  async getSalesOrders(params: SalesOrderListParams = {}): Promise<SalesOrdersResponse> {
    const query = this.buildQueryString(params);
    return this.request<SalesOrdersResponse>(`/quickbooks-desktop/sales-orders${query}`);
  }

  async getSalesOrder(id: string): Promise<QBSalesOrder> {
    return this.request<QBSalesOrder>(`/quickbooks-desktop/sales-orders/${id}`);
  }

  /**
   * Get all sales orders for a specific customer
   */
  async getSalesOrdersForCustomer(
    customerId: string,
    options: { updatedAfter?: string; includeFullyInvoiced?: boolean } = {}
  ): Promise<QBSalesOrder[]> {
    const salesOrders: QBSalesOrder[] = [];
    let cursor: string | undefined = undefined;
    let page = 0;
    const maxPages = 10;

    do {
      const params: SalesOrderListParams = {
        limit: 150,
        customerIds: customerId,
      };
      if (options.updatedAfter) params.updatedAfter = options.updatedAfter;
      if (cursor) params.cursor = cursor;

      const response = await this.getSalesOrders(params);
      if (response.data) {
        // Optionally filter out fully invoiced orders
        const filtered = options.includeFullyInvoiced
          ? response.data
          : response.data.filter((so) => !so.isFullyInvoiced);
        salesOrders.push(...filtered);
      }

      cursor = response.nextCursor;
      page++;
    } while (cursor && page < maxPages);

    return salesOrders;
  }

  // ============================================================
  // INVOICES
  // ============================================================

  async getInvoices(params: InvoiceListParams = {}): Promise<InvoicesResponse> {
    const query = this.buildQueryString(params);
    return this.request<InvoicesResponse>(`/quickbooks-desktop/invoices${query}`);
  }

  async getInvoice(id: string): Promise<QBInvoice> {
    return this.request<QBInvoice>(`/quickbooks-desktop/invoices/${id}`);
  }

  /**
   * Get all invoices for a specific customer
   */
  async getInvoicesForCustomer(
    customerId: string,
    options: { updatedAfter?: string; unpaidOnly?: boolean } = {}
  ): Promise<QBInvoice[]> {
    const invoices: QBInvoice[] = [];
    let cursor: string | undefined = undefined;
    let page = 0;
    const maxPages = 10;

    do {
      const params: InvoiceListParams = {
        limit: 150,
        customerIds: customerId,
      };
      if (options.updatedAfter) params.updatedAfter = options.updatedAfter;
      if (cursor) params.cursor = cursor;

      const response = await this.getInvoices(params);
      if (response.data) {
        const filtered = options.unpaidOnly
          ? response.data.filter((inv) => !inv.isPaid)
          : response.data;
        invoices.push(...filtered);
      }

      cursor = response.nextCursor;
      page++;
    } while (cursor && page < maxPages);

    return invoices;
  }

  // ============================================================
  // VENDORS (for completeness)
  // ============================================================

  async getVendors(params: ListParams = {}): Promise<VendorsResponse> {
    const query = this.buildQueryString(params);
    return this.request<VendorsResponse>(`/quickbooks-desktop/vendors${query}`);
  }

  async getVendor(id: string): Promise<QBVendor> {
    return this.request<QBVendor>(`/quickbooks-desktop/vendors/${id}`);
  }

  // ============================================================
  // CONNECTION TEST
  // ============================================================

  /**
   * Test the connection by fetching end user info
   */
  async testConnection(): Promise<{ success: boolean; endUser?: unknown; error?: string }> {
    try {
      const endUser = await this.request(`/end-users/${this.endUserId}`);
      return { success: true, endUser };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Default export for convenience
export default ConductorClient;
