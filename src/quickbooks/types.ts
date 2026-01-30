/**
 * QuickBooks Desktop entity types via Conductor.is API
 */

// ============================================================
// Common Types
// ============================================================

export interface QBRef {
  id: string;
  fullName?: string;
  name?: string;
}

export interface QBCustomField {
  name: string;
  value: string;
  type?: string;
}

export interface QBAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface QBListResponse<T> {
  objectType: "list";
  url: string;
  data: T[];
  nextCursor?: string;
}

// ============================================================
// Customer
// ============================================================

export interface QBCustomer {
  id: string;
  objectType: "qbd_customer";
  name: string;
  fullName: string;
  isActive: boolean;
  companyName?: string;
  email?: string;
  phone?: string;
  fax?: string;
  contact?: string;
  billingAddress?: QBAddress;
  shippingAddress?: QBAddress;
  balance?: string;
  totalBalance?: string;
  customFields?: QBCustomField[];
  createdAt?: string;
  updatedAt?: string;
}

// Simplified customer for matching
export interface QBCustomerMatch {
  id: string;
  name: string;
  fullName: string;
  companyName?: string;
  email?: string;
  phone?: string;
}

// ============================================================
// Estimate
// ============================================================

export interface QBEstimateLine {
  item?: QBRef;
  description?: string;
  quantity?: number;
  rate?: string;
  amount?: string;
  salesTaxCode?: QBRef;
}

export interface QBEstimate {
  id: string;
  objectType: "qbd_estimate";
  refNumber?: string;
  transactionDate: string;
  customer: QBRef;
  totalAmount?: string;
  memo?: string;
  isActive: boolean;
  lines?: QBEstimateLine[];
  customFields?: QBCustomField[];
  createdAt?: string;
  updatedAt?: string;
}


// ============================================================
// Sales Order
// ============================================================

export interface QBSalesOrderLine {
  item?: QBRef;
  description?: string;
  quantity?: number;
  rate?: string;
  amount?: string;
  salesTaxCode?: QBRef;
}

export interface QBSalesOrder {
  id: string;
  objectType: "qbd_sales_order";
  refNumber?: string;
  transactionDate: string;
  customer: QBRef;
  totalAmount?: string;
  memo?: string;
  isManuallyClosed: boolean;
  isFullyInvoiced: boolean;
  lines?: QBSalesOrderLine[];
  customFields?: QBCustomField[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================
// Invoice
// ============================================================

export interface QBInvoiceLine {
  item?: QBRef;
  description?: string;
  quantity?: number;
  rate?: string;
  amount?: string;
  salesTaxCode?: QBRef;
}

export interface QBInvoice {
  id: string;
  objectType: "qbd_invoice";
  refNumber?: string;
  transactionDate: string;
  dueDate?: string;
  customer: QBRef;
  totalAmount?: string;
  balanceRemaining?: string;
  isPaid: boolean;
  memo?: string;
  lines?: QBInvoiceLine[];
  linkedTransactions?: Array<{
    id: string;
    transactionType: string;
    refNumber?: string;
  }>;
  customFields?: QBCustomField[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================
// Vendor (for completeness)
// ============================================================

export interface QBVendor {
  id: string;
  objectType: "qbd_vendor";
  name: string;
  fullName: string;
  isActive: boolean;
  companyName?: string;
  email?: string;
  phone?: string;
  balance?: string;
  customFields?: QBCustomField[];
}

// ============================================================
// API Response Types
// ============================================================

export type CustomersResponse = QBListResponse<QBCustomer>;
export type EstimatesResponse = QBListResponse<QBEstimate>;
export type SalesOrdersResponse = QBListResponse<QBSalesOrder>;
export type InvoicesResponse = QBListResponse<QBInvoice>;
export type VendorsResponse = QBListResponse<QBVendor>;

// ============================================================
// Query Parameters
// ============================================================

export interface ListParams {
  limit?: number;
  cursor?: string;
  updatedAfter?: string;
  status?: "active" | "all" | "inactive";
}

export interface CustomerListParams extends ListParams {
  fullNames?: string;
  ids?: string;
}

export interface EstimateListParams extends ListParams {
  customerIds?: string;
  refNumbers?: string;
  transactionDateFrom?: string;
  transactionDateTo?: string;
}

export interface SalesOrderListParams extends ListParams {
  customerIds?: string;
  refNumbers?: string;
  transactionDateFrom?: string;
  transactionDateTo?: string;
}

export interface InvoiceListParams extends ListParams {
  customerIds?: string;
  refNumbers?: string;
  transactionDateFrom?: string;
  transactionDateTo?: string;
  isPaid?: boolean;
}
