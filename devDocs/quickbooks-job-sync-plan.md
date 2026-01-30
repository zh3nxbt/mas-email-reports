# QuickBooks Job Sync & Alert System

## Goal
Create an alert system that compares email-detected POs with QuickBooks data to identify sync discrepancies. When a customer sends a PO, the corresponding QB estimate should be marked "CONFIRMED" (or converted to a Sales Order).

## Architecture Decision
**Extend current repo** - shares email sync, database, and AI infrastructure. New modules will be clearly separated.

## Required QB Data Access
The system needs to access these QuickBooks entities:

| Entity | Purpose |
|--------|---------|
| **Customers** | Match email contacts to QB customer records |
| **Estimates** | Find quotes we sent - check if marked CONFIRMED when PO received |
| **Sales Orders** | (Future) May replace estimates as primary job tracking |
| **Invoices** | Complete the documentation chain - verify jobs are invoiced |

**Why all four?** Example flow:
1. PO received via email
2. Check if Sales Order exists for this customer/job
3. If no Sales Order → find the Estimate and flag it
4. After job complete → verify Invoice was created

## Current File Structure
```
src/
  quickbooks/                    # QB integration
    conductor-client.ts          # ✅ Conductor API client
    types.ts                     # ✅ QB entity types (Customer, Estimate, SalesOrder, Invoice)
    customer-matcher.ts          # ✅ Fuzzy matching email contacts to QB customers
    job-documents.ts             # ✅ Unified job document fetching + estimate status parsing
    trusted-domains.ts           # ✅ Domain trust filter (prevents phishing PDF analysis)
    index.ts                     # ✅ Module exports
    test-connection.ts           # ✅ Test script (npm run qb:test)
  jobs/                          # Job tracking (future phases)
    sync-analyzer.ts             # ✅ Compare emails vs QB data (placeholder with trust filter)
    alert-generator.ts           # Generate discrepancy alerts
    run-jobs-report.ts           # CLI entry point
```

## Implementation Phases

### Phase 1: Port Conductor Client to TypeScript ✅
- [x] Copy `temp/mas-quickbooks-data/conductor-client.js` logic
- [x] Convert to TypeScript with proper types
- [x] Methods implemented:
  - `getCustomers()` / `getCustomer(id)`
  - `getEstimates()` / `getEstimate(id)` / `getEstimatesForCustomer()`
  - `getSalesOrders()` / `getSalesOrder(id)` / `getSalesOrdersForCustomer()`
  - `getInvoices()` / `getInvoice(id)` / `getInvoicesForCustomer()`
  - `getVendors()` / `getVendor(id)`
  - `testConnection()`
- [x] Env vars: `CONDUCTOR_API_KEY`, `CONDUCTOR_END_USER_ID`

### Phase 2: Customer Matching ✅
- [x] Created `customer-matcher.ts`
- [x] Fetch QB customers with `getCustomerListForMatching()`
- [x] Match email `contactEmail` or `contactName` to QB customer
- [x] Fuzzy matching (normalize names, handle variations)
- [x] Returns `{ customerId, customerName, confidence, matchType }` or `null`

### Phase 3: Job Documents Organization ✅ (partial)
- [x] Created `job-documents.ts` with:
  - `getCustomerJobDocuments()` - fetches estimates, sales orders, invoices in parallel
  - `parseEstimateStatus()` - extracts CONFIRMED/COMPLETE/BLANK from custom field
  - `getJobDocumentsSummary()` - statistics for quick overview
  - Helper functions for filtering and analysis
- [x] Added to test script (`npm run qb:test`)

**⏸️ BLOCKED:** Awaiting decision on Estimates vs Sales Orders as primary job tracker
- If Sales Orders are used properly, estimate status (CONFIRMED/COMPLETE/BLANK) becomes obsolete
- Job status would be inferred from document chain: Estimate → Sales Order → Invoice
- Note added in code about this potential obsolescence

### Phase 3.5: Trusted Domain Filter ✅
Created `trusted-domains.ts` to prevent processing emails from suspicious domains:
- [x] `getTrustedDomains()` - builds combined set from:
  - Domains we've emailed (extracted from sent folder recipients)
  - Manual whitelist from `TRUSTED_DOMAINS` env var
- [x] `isDomainTrusted(email, trustedDomains)` - checks if email domain is trusted
- [x] `getTrustedDomainsStats()` - debugging/logging helper
- [x] Added to test script (`npm run qb:test`)
- [x] Created `src/jobs/sync-analyzer.ts` placeholder with trust filter integration

**Why this matters:**
- Protects against analyzing infected PDF attachments from phishing emails
- Prevents wasting API calls matching phishing emails to QB customers
- Automatically trusts domains we have business relationships with

**Config:**
```env
# Optional manual whitelist (comma-separated)
TRUSTED_DOMAINS=newvendor.com,legitcustomer.ca
```

### Phase 4: Sync Analyzer (IN PROGRESS)
Created `sync-analyzer.ts` with trust filter, full logic TODO:
- [x] Trust filter integration (skip untrusted domains before PDF analysis)
- [ ] Input: Recent `po_received` threads from email-fetcher + QB data
- [ ] Logic:
  ```
  For each po_received thread:
    1. Skip if domain is untrusted ✅
    2. Find matching QB customer
    3. Find Sales Orders OR Estimates for that customer
    4. Check if any matches (by amount, date proximity, or reference)
    5. Flag discrepancies
  ```
- [ ] Output: Array of `SyncDiscrepancy` objects

### Phase 5: Alert Types (NOT STARTED)
```typescript
type SyncAlert = {
  type:
    | "po_no_estimate"        // PO received, no matching estimate found
    | "po_no_sales_order"     // PO received, no Sales Order created
    | "po_not_confirmed"      // PO received, estimate exists but not CONFIRMED
    | "job_not_invoiced"      // Sales Order complete but no invoice
    | "suspicious_po_email"   // PO email from untrusted domain (potential phishing)
  customer: { email: string, name: string, qbId?: string }
  poThread?: CategorizedThread
  estimate?: QBEstimate
  salesOrder?: QBSalesOrder
  suggestedAction: string
}
```

**Alert descriptions:**
| Alert Type | Trigger | Suggested Action |
|------------|---------|------------------|
| `po_no_estimate` | Customer sent PO, no matching estimate in QB | Create estimate or check if job exists under different name |
| `po_no_sales_order` | PO received, estimate exists but no SO created | Convert estimate to Sales Order |
| `po_not_confirmed` | PO received, estimate exists but status ≠ CONFIRMED | Update estimate status to CONFIRMED |
| `job_not_invoiced` | Sales Order marked complete but no invoice | Create invoice for completed job |
| `suspicious_po_email` | PO email from domain we've never emailed | Review manually - may be phishing or new customer |

### Phase 6: Scheduled Alerts (NOT STARTED)
**Schedule:** Run hourly from 9am to 4pm EST (business hours)

**Command:** `npm run jobs:check` - checks for new POs and sends alert email if issues found

**Behavior:**
1. Sync recent emails (last hour)
2. Find new `po_received` threads
3. Run trust filter (flag suspicious domains)
4. Match trusted POs to QB data
5. Generate alerts for any discrepancies
6. **Only send email if alerts exist** (no spam on clean runs)

**Email content:**
- Summary: "3 PO alerts detected"
- Grouped by alert type
- Each alert shows: customer, subject, suggested action
- Suspicious emails shown separately with warning styling

## Related Work: PDF Vision Analysis ✅

Implemented visual PDF analysis for extracting PO details from email attachments:
- `src/report/pdf-extractor.ts` - sends PDF as base64 to Claude for visual analysis
- Replaces old text-extraction approach (pdf-parse) which lost formatting
- Test script: `src/report/test-pdf-vision.ts`

**TODO:** Add DOCX support (Claude doesn't support DOCX directly)

## Matching Strategy
Since PO numbers may not directly match estimate numbers:
1. **Primary**: Customer email/name match
2. **Secondary**: Amount within tolerance (±5%)
3. **Tertiary**: Date proximity (estimate created before PO received)
4. **Manual override**: Store confirmed matches in DB

## Verification Plan
1. [x] Run test script to verify Conductor connection
2. [x] Verify customer matching works (check a known customer)
3. [x] Verify estimate/sales order fetching returns expected data
4. [ ] Test edge cases: new customer (no QB match), multiple estimates per customer

## Future Enhancements
- Auto-update QB estimate status via API
- Dashboard UI for job tracking
- Sales Order conversion workflow
- Invoice generation reminders
