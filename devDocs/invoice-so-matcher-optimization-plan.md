# Plan: Invoice/SO Matcher Optimization

> Created: 2026-02-02
> Status: Ready for implementation
> Related: Job Sync Step 4-6 (Alert Creation/Escalation/Resolution)

## Summary

Replace the slow LLM-based Invoice/SO matching with simple PO# + total value comparison. Currently O(n×m) API calls, proposed is O(n×m) simple comparisons (no API calls).

## Problem

Current implementation in `src/quickbooks/invoice-so-matcher.ts`:
```typescript
// For EACH sales order × EACH invoice = N×M LLM calls!
for (const so of salesOrders) {
  for (const invoice of invoices) {
    const match = await analyzeMatch(client, so, invoice);  // ← LLM call
  }
}
```

With 10 SOs and 10 invoices = **100 sequential LLM calls** = very slow!

## Solution

Match by PO# first, then compare totals. No LLM needed.

| PO# Match | Total Comparison | Result |
|-----------|------------------|--------|
| Yes | Invoice = SO total | Fully invoiced → close SO |
| Yes | Invoice < SO total | Partial billing → OK, keep SO open |
| Yes | Invoice > SO total | Alert: overbilled? |
| No | - | No match, skip |

## Implementation Steps

### Step 1: Add Simple Matcher Function

**File:** `src/quickbooks/invoice-so-matcher.ts`

Replace or add alongside existing LLM matcher:

```typescript
interface SimpleMatchResult {
  salesOrder: QBSalesOrder;
  invoice: QBInvoice;
  isMatch: boolean;
  matchType: 'full' | 'partial' | 'overbilled' | 'none';
  soTotal: number;
  invoiceTotal: number;
  difference: number;  // positive = under-billed, negative = over-billed
}

export function matchByPoNumber(
  salesOrders: QBSalesOrder[],
  invoices: QBInvoice[]
): SimpleMatchResult[] {
  const matches: SimpleMatchResult[] = [];

  for (const so of salesOrders) {
    // Extract PO# from SO (customerPo field or refNumber)
    const soPo = so.customerPo || so.refNumber;
    if (!soPo) continue;

    for (const invoice of invoices) {
      // Check if invoice references this PO
      const invoicePo = invoice.customerPo || invoice.refNumber;

      if (soPo === invoicePo) {
        const soTotal = parseFloat(so.totalAmount || '0');
        const invTotal = parseFloat(invoice.totalAmount || '0');
        const diff = soTotal - invTotal;

        let matchType: 'full' | 'partial' | 'overbilled';
        if (Math.abs(diff) < 0.01) {
          matchType = 'full';
        } else if (diff > 0) {
          matchType = 'partial';
        } else {
          matchType = 'overbilled';
        }

        matches.push({
          salesOrder: so,
          invoice: invoice,
          isMatch: true,
          matchType,
          soTotal,
          invoiceTotal: invTotal,
          difference: diff,
        });
      }
    }
  }

  return matches;
}
```

---

### Step 2: Update findSosShouldBeClosed

**File:** `src/quickbooks/invoice-so-matcher.ts`

Replace LLM-based matching with simple matching:

```typescript
export function findSosShouldBeClosed(
  salesOrders: QBSalesOrder[],
  invoices: QBInvoice[]
): SimpleMatchResult[] {
  // Only check open sales orders
  const openSOs = salesOrders.filter((so) => !so.isManuallyClosed && !so.isFullyInvoiced);

  if (openSOs.length === 0) {
    return [];
  }

  const matches = matchByPoNumber(openSOs, invoices);

  // Return fully invoiced SOs that should be closed
  return matches.filter((m) => m.matchType === 'full');
}
```

---

### Step 3: Add Overbilled Alert (Optional)

**File:** `src/jobs/alert-manager.ts`

If invoice total > SO total, create alert:

```typescript
// In checkInvoiceSoMismatch or new function
const overbilled = matches.filter((m) => m.matchType === 'overbilled');
for (const match of overbilled) {
  // Create alert: "Invoice $X exceeds SO $Y by $Z"
}
```

---

### Step 4: Remove LLM Dependency

**File:** `src/quickbooks/invoice-so-matcher.ts`

- Remove `import Anthropic from "@anthropic-ai/sdk"`
- Remove `analyzeMatch()` function (or keep for fallback)
- Remove LLM-related types

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/quickbooks/invoice-so-matcher.ts` | Replace LLM matching with PO# + total comparison |
| `src/jobs/alert-manager.ts` | Update to use new matcher, optionally add overbilled alert |

---

## Verification Plan

1. **Test exact match:**
   - SO with PO# "12345" and total $1000
   - Invoice with PO# "12345" and total $1000
   - Verify: matchType = 'full', SO flagged for closing

2. **Test partial billing:**
   - SO with PO# "12345" and total $1000
   - Invoice with PO# "12345" and total $500
   - Verify: matchType = 'partial', SO stays open

3. **Test overbilled:**
   - SO with PO# "12345" and total $1000
   - Invoice with PO# "12345" and total $1200
   - Verify: matchType = 'overbilled', alert created

4. **Test no match:**
   - SO with PO# "12345"
   - Invoice with PO# "99999"
   - Verify: no match found

5. **Performance test:**
   - 50 SOs × 50 invoices = 2500 comparisons
   - Should complete in < 100ms (vs minutes with LLM)

---

## Notes

- PO# matching is exact string comparison (may need normalization for "PO-12345" vs "12345")
- Consider adding fuzzy matching for PO# variations (trim, lowercase, remove prefix)
- Totals compared with small epsilon (0.01) for floating point tolerance
- Keep LLM matcher as fallback for edge cases? (optional)
