# Plan: Smart PO Detection with AI Attachment Selection

> Created: 2026-02-02
> Status: Ready for implementation

## Summary

Upgrade the PO detection logic to use AI-based attachment selection, validate that documents are actually POs, and flag for manual review when they're not.

## Steps Overview

| Step | Description | File(s) |
|------|-------------|---------|
| 1 | Add failure logging to `/logs/po-detection-failures.log` | `logger.ts` |
| 2 | AI ranks attachments by filename to find PO candidates | `summarizer.ts` |
| 3 | Fetch specific attachment (not all PDFs) | `po-attachment-manager.ts` |
| 4 | Analyze PDF + validate it's actually a PO | `po-attachment-manager.ts` |
| 5 | Orchestrate: loop candidates, retry on failure, handle multi-PO | `po-detector.ts` (new) |
| 6 | Integrate into categorizer + update templates | `categorizer.ts`, `templates.ts` |

**Database:** Add `isValidPo`, `notPoReason` columns to `email_po_attachments` only.

## Current vs Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Attachment selection** | Grabs ALL PDFs, uses first one | AI ranks filenames, tries each until valid PO found |
| **Email scope** | Any email in thread with attachments | Only the specific `po_received` email |
| **PO validation** | Assumes all PDFs are POs | AI confirms it's actually a PO |
| **Fallback** | None - keeps po_received even if not a PO | Flag as `needsReview` for manual review |
| **Failure logging** | Console only | Structured logs in `/logs/po-detection-failures.log` |

## Implementation Steps

### Step 1: Add PO Detection Failure Logging

**File:** `src/utils/logger.ts`

Add new logging function for PO detection failures:
- `logPoDetectionFailure(failure)` - append JSON log entry
- `getRecentPoFailures(limit)` - read recent failures for review
- Log file: `logs/po-detection-failures.log`

**Failure stages to track:**
- `no_attachments` - Thread marked po_received but no attachments
- `no_po_candidate` - Attachments found but none look like POs
- `fetch_failed` - IMAP fetch failed
- `analysis_failed` - Claude analysis failed
- `not_a_po` - AI determined document is not a PO

---

### Step 2: Add AI Attachment Selection

**File:** `src/report/summarizer.ts`

Add function `rankAttachmentsForPo(attachments, subject, sender)`:
- Input: list of `{filename, contentType, size}` from email
- Output: ranked list with `{filename, rank, isPoCandidate, reason}`
- Uses Haiku for speed/cost (simple filename analysis)

**Prompt logic:**
- INCLUDE: Files with "PO", "Purchase Order", "Order" in name
- EXCLUDE: Signature images (<100KB PNG/JPG), logos, T&C docs

---

### Step 3: Add Specific Attachment Fetching

**File:** `src/storage/po-attachment-manager.ts`

Add function `fetchSpecificAttachment(uid, mailbox, targetFilename)`:
- Unlike `fetchPdfsFromImap()` which fetches ALL
- Returns only the requested attachment by filename match
- Fallback: if exact match not found, try partial match

---

### Step 4: Enhanced PO Validation in Analysis

**File:** `src/storage/po-attachment-manager.ts`

Modify `analyzePdfWithVision()` prompt to also return:
```json
{
  "isValidPo": true,
  "notPoReason": null,  // or "This is a quotation, not a PO"
  // ...existing fields...
}
```

Add wrapper function `analyzeAndValidatePo(pdfBuffer, context)`:
- Returns `{ details, isValidPo, reason }`
- Context includes subject/sender for better validation

---

### Step 5: Smart PO Detection Orchestration

**New file:** `src/report/po-detector.ts`

Main function `smartPoDetection(email, threadKey, threadSubject)`:
```
1. Parse email.attachments to get list
2. Call rankAttachmentsForPo() to get ranked candidates
3. If no candidates → log failure (no_po_candidate), return

4. FOR EACH candidate (in rank order):
   a. Fetch attachment via fetchSpecificAttachment()
   b. If fetch fails → log, continue to next
   c. Analyze with analyzeAndValidatePo()
   d. If isValidPo=true → store in DB, add to validPOs list
   e. If isValidPo=false → log reason, continue to next

5. After processing ALL candidates:
   - If validPOs.length > 0 → success (may have multiple POs)
   - If validPOs.length === 0 → needsReclassification=true, log failure
```

Returns:
```typescript
{
  success: boolean;
  poDetailsList: PoDetails[];  // Can have multiple POs!
  primaryPo: PoDetails | null; // First/main PO for backward compat
  needsReclassification: boolean;
  attemptedFiles: Array<{
    filename: string;
    result: 'success' | 'fetch_failed' | 'not_a_po';
    reason?: string;
  }>;
}
```

**Storage policy:**
- ALL analyzed attachments are uploaded to Supabase + added to `email_po_attachments`
- `isValidPo` column distinguishes valid POs from non-POs
- This allows re-review without re-fetching from IMAP

**Multiple PO handling:**
- All valid POs have `isValidPo = true` in table
- `poDetailsList` contains all extracted PO details (where `isValidPo = true`)
- `primaryPo` is the first valid PO (for existing code compatibility)
- Thread shows combined info: "PO-1234, PO-1235 ($5,000 + $3,200)"

---

### Step 6: Modify Categorizer + Templates

**File:** `src/report/categorizer.ts`

Modify `enrichPoReceivedThreads()`:
1. Replace current logic (lines 510-526) with call to `smartPoDetection()`
2. For successful detection:
   - Set `thread.poDetails = result.primaryPo` (backward compat, in-memory only)
   - All PO data is stored in `email_po_attachments` table
3. For threads where no valid PO found:
   - Results stored in `email_po_attachments` with `isValidPo = false`
   - Log to `/logs/po-detection-failures.log`
4. Keep `itemType` as `po_received` (don't auto-change classification)

**File:** `src/report/templates.ts`

When rendering `po_received` threads:
- Query `email_po_attachments` by threadKey
- If any attachment has `isValidPo = false`, show warning badge
- Display `notPoReason` from the attachment record
- If multiple valid POs, show combined info

**Key change in finding the PO email (line 510-514):**
- Current: `thread.emails.find(e => e.hasAttachments && e.attachments.includes("pdf"))`
- Proposed: Find the specific email that was classified as containing the PO (usually the first inbound email with attachments)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/db/schema.ts` | Add `isValidPo`, `notPoReason` columns to `email_po_attachments` |
| `src/utils/logger.ts` | Add `logPoDetectionFailure()` and `getRecentPoFailures()` |
| `src/report/summarizer.ts` | Add `rankAttachmentsForPo()` AI function |
| `src/storage/po-attachment-manager.ts` | Add `fetchSpecificAttachment()`, modify `analyzePdfWithVision()` |
| `src/report/po-detector.ts` | **NEW** - orchestration module |
| `src/report/categorizer.ts` | Update `enrichPoReceivedThreads()` to use new flow |
| `src/report/templates.ts` | Query `email_po_attachments` for review status, show warning badge |

---

## Verification Plan

1. **Unit test attachment ranking:**
   - Test with filenames like `["PO-1234.pdf", "signature.png", "logo.jpg"]`
   - Verify PO file ranked first, images excluded

2. **Integration test with real emails:**
   - Run `npm run jobs:check -- --preview` on known PO emails
   - Verify correct attachment selected and analyzed

3. **Test needs_review flow:**
   - Find an email with non-PO PDF that was misclassified as `po_received`
   - Verify `email_po_attachments` record has `isValidPo=false` and `notPoReason` populated
   - Verify warning indicator appears in email template
   - Verify log entry written to `/logs/po-detection-failures.log`

4. **Test failure logging:**
   - Process email with no attachments marked as `po_received`
   - Verify failure logged with stage `no_attachments`

5. **Test retry logic:**
   - Process email with multiple PDFs (e.g., quote.pdf, PO-1234.pdf)
   - Verify system tries quote.pdf first (if ranked higher), detects it's not a PO
   - Verify system then tries PO-1234.pdf and succeeds
   - Verify `attemptedFiles` array shows both attempts

6. **Test multiple POs in one email:**
   - Process email with PO-1234.pdf and PO-1235.pdf
   - Verify both are detected, stored, and analyzed
   - Verify `poDetailsList` contains both PO details
   - Verify thread displays combined info (e.g., "PO-1234, PO-1235")

---

## Database Changes

**Only `email_po_attachments` table is modified** - no changes to other tables.

Add columns to `email_po_attachments`:
```sql
isValidPo BOOLEAN DEFAULT NULL,      -- NULL = not analyzed, true = confirmed PO, false = not a PO
notPoReason TEXT DEFAULT NULL,       -- Why it's not a PO (e.g., "This is a quotation")
```

This keeps all PO detection data in one table. When generating reports:
- Query `email_po_attachments` by threadKey to get all PO analysis results
- Check `isValidPo = false` to find threads needing review
- No schema changes to `report_threads`, `emails`, or other tables

---

## Notes
- **Store all analyzed files**: Both valid POs and non-POs are uploaded + stored (use `isValidPo` to filter)
- Logger infrastructure already exists - just adding new log type
- Use Haiku for attachment ranking (fast/cheap), Sonnet for PDF analysis (existing)
- **Retry logic**: If first-ranked attachment isn't a valid PO, system tries next candidate before flagging for review
- **Multiple POs**: System processes ALL candidates, collecting all valid POs (not stopping at first)
- All attempted files are tracked in `attemptedFiles` array for debugging/logging
- `primaryPo` field maintains backward compatibility with existing code expecting single PO
- **No changes to other tables**: All data stored in `email_po_attachments` only

---

## Related Future Work

**Invoice/SO Matcher Optimization** (separate task):
- Current: Uses LLM to compare each SO × Invoice pair (O(n×m) API calls - very slow!)
- Proposed: Simple PO# + total value matching, no LLM needed
- Logic: Match by PO#, then compare totals (equal = close SO, invoice < SO = partial billing OK, invoice > SO = alert)
