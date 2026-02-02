/**
 * PO Attachment Manager
 *
 * Handles storing PO PDFs in Supabase Storage and caching analysis results.
 * This avoids re-fetching PDFs from IMAP on every run.
 *
 * Flow:
 * 1. Check if attachment already stored (by emailId + filename)
 * 2. If not stored: fetch from IMAP → upload to Supabase → save to DB
 * 3. For DOCX files: convert to PDF before storing
 * 4. If analysis needed: call Claude → cache results in DB
 * 5. Return attachment with cached analysis if available
 */

import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import {
  uploadPdf,
  downloadPdf,
  generateStoragePath,
  isSupabaseConfigured,
} from "./supabase-client";
import { createImapClient, fetchBodyPart } from "@/imap/client";
import { flattenBodyStructure } from "@/imap/parsers";
import type { Email, PoAttachment, NewPoAttachment } from "@/db/schema";
import type { PoDetails } from "@/report/types";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const anthropic = new Anthropic();

// ============================================================
// Types
// ============================================================

export interface StoredAttachment {
  id: number;
  emailId: number;
  threadKey: string;
  filename: string;
  storagePath: string;
  sizeBytes: number | null;
  // Cached analysis (null if not yet analyzed)
  poNumber: string | null;
  poTotal: number | null;
  analysisJson: any | null;
  analyzedAt: Date | null;
}

export interface FetchedPdf {
  filename: string;
  content: Buffer;
  contentType: string;
  originalFilename?: string; // For converted files (e.g., DOCX → PDF)
}

// ============================================================
// DOCX to PDF Conversion
// ============================================================

/**
 * Convert Word document (DOCX) to PDF buffer
 * Uses docx-pdf library - only supports .docx (Office Open XML)
 * Legacy .doc (OLE format) cannot be converted - returns null
 */
async function convertWordToPdf(docBuffer: Buffer, filename: string): Promise<Buffer | null> {
  const ext = path.extname(filename).toLowerCase();

  // docx-pdf only supports .docx, NOT legacy .doc (OLE format)
  if (ext === ".doc") {
    console.warn(`  Skipping .doc file (legacy format not supported): ${filename}`);
    console.warn(`  → To convert .doc files, install LibreOffice and use: soffice --convert-to pdf`);
    return null;
  }

  const tempDir = os.tmpdir();
  const baseName = path.basename(filename, ext);
  const inputPath = path.join(tempDir, `${baseName}_${Date.now()}${ext}`);
  const pdfPath = path.join(tempDir, `${baseName}_${Date.now()}.pdf`);

  try {
    // Write to temp file
    fs.writeFileSync(inputPath, docBuffer);

    // Convert using docx-pdf (dynamic import for ES modules)
    const docxPdfModule = await import("docx-pdf");
    const docxPdf = docxPdfModule.default || docxPdfModule;
    await new Promise<void>((resolve, reject) => {
      docxPdf(inputPath, pdfPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Read PDF result
    const pdfBuffer = fs.readFileSync(pdfPath);
    return pdfBuffer;
  } catch (error) {
    console.error(`  Word conversion failed for ${filename}:`, error);
    return null;
  } finally {
    // Clean up temp files
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(pdfPath); } catch {}
  }
}

// ============================================================
// IMAP PDF Fetching (copied from pdf-extractor.ts)
// ============================================================

function normalizeDisposition(disposition: any): {
  type?: string;
  params?: Record<string, string>;
} {
  if (!disposition) return {};
  if (typeof disposition === "string") {
    return { type: disposition };
  }
  return {
    type: disposition.type || disposition.disposition || disposition.value,
    params: disposition.params || disposition.parameters || disposition.params,
  };
}

/**
 * Check if a file is a Word document based on filename or content type
 */
function isWordDoc(filename: string | undefined, contentType: string): boolean {
  const lowerFilename = filename?.toLowerCase() || "";
  // .docx (modern) or .doc (legacy)
  if (lowerFilename.endsWith(".docx") || lowerFilename.endsWith(".doc")) return true;
  if (contentType.includes("openxmlformats-officedocument.wordprocessingml")) return true;
  if (contentType.includes("msword")) return true;
  return false;
}

/**
 * Check if a file is a PDF based on filename or content type
 */
function isPdf(filename: string | undefined, contentType: string): boolean {
  if (filename?.toLowerCase().endsWith(".pdf")) return true;
  if (contentType.includes("pdf")) return true;
  return false;
}

/**
 * Fetch PDF and DOCX attachments from an email via IMAP
 * DOCX files are converted to PDF
 */
export async function fetchPdfsFromImap(
  uid: number,
  mailbox: string
): Promise<FetchedPdf[]> {
  const client = createImapClient();
  const results: FetchedPdf[] = [];

  try {
    await client.connect();
    await client.mailboxOpen(mailbox, { readOnly: true });

    const msg = await client.fetchOne(uid, { bodyStructure: true }, { uid: true });

    if (!msg || !(msg as any).bodyStructure) {
      return results;
    }

    const nodes = flattenBodyStructure((msg as any).bodyStructure);

    for (const node of nodes) {
      const contentType = `${node.type || ""}/${node.subtype || ""}`.toLowerCase();
      const params = node.params || node.parameters || {};
      const disposition = normalizeDisposition(node.disposition);
      const filename = disposition.params?.filename || params.name || params.filename;
      const encoding = (node.encoding || "").toLowerCase();

      const fileIsPdf = isPdf(filename, contentType);
      const fileIsWord = isWordDoc(filename, contentType);

      if ((fileIsPdf || fileIsWord) && node.part) {
        try {
          const rawContent = await fetchBodyPart(client, uid, node.part);
          if (rawContent) {
            let content = rawContent;

            // Decode base64 if needed
            if (encoding === "base64") {
              content = Buffer.from(rawContent.toString("ascii"), "base64");
            } else {
              // Try base64 decode as fallback
              try {
                const decoded = Buffer.from(rawContent.toString("ascii"), "base64");
                // Check if it looks like valid decoded content
                if (decoded.length > 0 && decoded.length < rawContent.length) {
                  content = decoded;
                }
              } catch {
                // Keep original
              }
            }

            if (fileIsWord) {
              // Convert Word doc to PDF
              console.log(`  Converting Word to PDF: ${filename}`);
              const pdfContent = await convertWordToPdf(content, filename || "document.docx");
              if (pdfContent) {
                const pdfFilename = (filename || "document.docx").replace(/\.(docx?|doc)$/i, ".pdf");
                results.push({
                  filename: pdfFilename,
                  content: pdfContent,
                  contentType: "application/pdf",
                  originalFilename: filename,
                });
              }
            } else {
              // PDF - verify magic number
              const first4 = content.slice(0, 4).toString("ascii");
              if (first4 !== "%PDF") {
                // Try one more base64 decode
                try {
                  const decoded = Buffer.from(content.toString("ascii"), "base64");
                  if (decoded.slice(0, 4).toString("ascii") === "%PDF") {
                    content = decoded;
                  }
                } catch {
                  // Keep as is
                }
              }

              results.push({
                filename: filename || "attachment.pdf",
                content,
                contentType: "application/pdf",
              });
            }
          }
        } catch (error) {
          console.error(`Failed to fetch attachment part ${node.part}:`, error);
        }
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore
    }
  }

  return results;
}

// ============================================================
// Storage Operations
// ============================================================

/**
 * Get existing attachment record from database
 */
export async function getStoredAttachment(
  emailId: number,
  filename: string
): Promise<PoAttachment | null> {
  const results = await db
    .select()
    .from(schema.poAttachments)
    .where(
      and(
        eq(schema.poAttachments.emailId, emailId),
        eq(schema.poAttachments.filename, filename)
      )
    )
    .limit(1);

  return results[0] || null;
}

/**
 * Get all stored attachments for a thread
 */
export async function getStoredAttachmentsForThread(
  threadKey: string
): Promise<PoAttachment[]> {
  return db
    .select()
    .from(schema.poAttachments)
    .where(eq(schema.poAttachments.threadKey, threadKey));
}

/**
 * Store a PDF attachment in Supabase and record in database.
 * If Supabase is not configured, only records metadata in database (no file storage).
 */
export async function storeAttachment(
  email: Email,
  threadKey: string,
  pdf: FetchedPdf
): Promise<PoAttachment | null> {
  // Check if already stored
  const existing = await getStoredAttachment(email.id, pdf.filename);
  if (existing) {
    console.log(`  Already stored: ${pdf.filename}`);
    return existing;
  }

  // Generate storage path
  const storagePath = generateStoragePath(
    email.id,
    pdf.filename,
    email.date || new Date()
  );

  // Upload to Supabase (if configured)
  if (isSupabaseConfigured()) {
    console.log(`  Uploading to Supabase: ${storagePath}`);
    const { error: uploadError } = await uploadPdf(
      storagePath,
      pdf.content,
      pdf.contentType
    );

    if (uploadError) {
      console.error(`  Upload failed: ${uploadError}`);
      // Continue anyway - we can still cache analysis in database
    }
  } else {
    console.log(`  Supabase not configured, skipping file storage`);
  }

  // Save to database (metadata + will cache analysis later)
  const newAttachment: NewPoAttachment = {
    emailId: email.id,
    threadKey,
    filename: pdf.filename,
    originalFilename: pdf.originalFilename || null,
    storagePath,
    contentType: pdf.contentType,
    sizeBytes: pdf.content.length,
  };

  const [inserted] = await db
    .insert(schema.poAttachments)
    .values(newAttachment)
    .returning();

  console.log(`  Stored: ${pdf.filename} (${(pdf.content.length / 1024).toFixed(0)} KB)`);
  return inserted;
}

/**
 * Fetch PDF from email and store in Supabase
 * Returns all stored attachments (existing + newly stored)
 */
export async function fetchAndStorePdfs(
  email: Email,
  threadKey: string
): Promise<PoAttachment[]> {
  const results: PoAttachment[] = [];

  // Fetch PDFs from IMAP
  console.log(`Fetching PDFs from email ${email.uid} (${email.mailbox})`);
  const pdfs = await fetchPdfsFromImap(email.uid, email.mailbox);

  if (pdfs.length === 0) {
    console.log(`  No PDFs found`);
    return results;
  }

  console.log(`  Found ${pdfs.length} PDF(s)`);

  // Store each PDF
  for (const pdf of pdfs) {
    const stored = await storeAttachment(email, threadKey, pdf);
    if (stored) {
      results.push(stored);
    }
  }

  return results;
}

/**
 * Download PDF content from Supabase Storage
 */
export async function getPdfContent(
  storagePath: string
): Promise<Buffer | null> {
  const { content, error } = await downloadPdf(storagePath);
  if (error) {
    console.error(`Failed to download PDF: ${error}`);
    return null;
  }
  return content;
}

/**
 * Update attachment with analysis results
 */
export async function updateAttachmentAnalysis(
  attachmentId: number,
  analysis: {
    poNumber: string | null;
    poTotal: number | null; // cents
    analysisJson: any;
  }
): Promise<void> {
  await db
    .update(schema.poAttachments)
    .set({
      poNumber: analysis.poNumber,
      poTotal: analysis.poTotal,
      analysisJson: analysis.analysisJson,
      analyzedAt: new Date(),
    })
    .where(eq(schema.poAttachments.id, attachmentId));
}

/**
 * Check if attachment has cached analysis
 */
export function hasAnalysis(attachment: PoAttachment): boolean {
  return attachment.analyzedAt !== null;
}

/**
 * Get cached analysis from attachment
 */
export function getCachedAnalysis(attachment: PoAttachment): {
  poNumber: string | null;
  poTotal: number | null;
  analysisJson: any | null;
} | null {
  if (!hasAnalysis(attachment)) {
    return null;
  }
  return {
    poNumber: attachment.poNumber,
    poTotal: attachment.poTotal,
    analysisJson: attachment.analysisJson,
  };
}

// ============================================================
// PDF Analysis with Claude Vision
// ============================================================

/**
 * Analyze a PDF using Claude's visual document understanding
 */
async function analyzePdfWithVision(pdfBuffer: Buffer): Promise<PoDetails | null> {
  const pdfBase64 = pdfBuffer.toString("base64");

  // Check size limit (32MB max for API, but be conservative)
  const sizeMB = pdfBuffer.length / (1024 * 1024);
  if (sizeMB > 25) {
    console.warn(`PDF too large for vision analysis: ${sizeMB.toFixed(1)}MB`);
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: `Extract purchase order details from this document.

Return JSON only:
{
  "poNumber": "string or null",
  "vendor": "vendor/supplier name or null",
  "items": [{"description": "string", "quantity": number or null, "unitPrice": number or null, "lineTotal": number or null}],
  "total": number or null,
  "currency": "USD"
}

If this is not a PO/invoice/quote, return: {"poNumber": null, "vendor": null, "items": [], "total": null, "currency": "USD"}`,
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return null;
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("No JSON found in Claude response");
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as {
      poNumber?: string | null;
      vendor?: string | null;
      items?: Array<{
        description: string;
        quantity: number | null;
        unitPrice: number | null;
        lineTotal: number | null;
      }>;
      total?: number | null;
      currency?: string;
    };

    return {
      poNumber: result.poNumber || null,
      vendor: result.vendor || null,
      items: (result.items || []).map((item) => ({
        description: item.description,
        quantity: item.quantity ?? null,
        unitPrice: item.unitPrice ?? null,
        lineTotal: item.lineTotal ?? null,
      })),
      total: result.total ?? null,
      currency: result.currency || "USD",
    };
  } catch (error) {
    console.error("PDF vision analysis failed:", error);
    return null;
  }
}

// ============================================================
// Unified: Get or Analyze PO PDF (with caching)
// ============================================================

/**
 * Get PO details from an email's PDF attachments.
 * This is the main function to use - it handles:
 * 1. Checking cache for existing analysis
 * 2. Fetching PDF from IMAP if not cached
 * 3. Storing PDF to Supabase
 * 4. Analyzing with Claude
 * 5. Caching the results
 *
 * Returns the first successfully analyzed PDF's details.
 */
export async function getOrAnalyzePoPdf(
  email: Email,
  threadKey: string
): Promise<{ filename: string; details: PoDetails } | null> {
  // First, check if we have any cached analysis for this email
  const existingAttachments = await db
    .select()
    .from(schema.poAttachments)
    .where(eq(schema.poAttachments.emailId, email.id));

  // Check for cached analysis
  for (const att of existingAttachments) {
    if (hasAnalysis(att) && att.analysisJson) {
      console.log(`  Using cached analysis for: ${att.filename}`);
      const cached = getCachedAnalysis(att);
      if (cached?.analysisJson) {
        return {
          filename: att.filename,
          details: cached.analysisJson as PoDetails,
        };
      }
    }
  }

  // No cached analysis - need to fetch, store, and analyze
  console.log(`  Fetching PDFs from IMAP for email ${email.uid}`);
  const pdfs = await fetchPdfsFromImap(email.uid, email.mailbox);

  if (pdfs.length === 0) {
    console.log(`  No PDFs found in email ${email.uid}`);
    return null;
  }

  // Process each PDF
  for (const pdf of pdfs) {
    // Store to Supabase (if not already stored)
    const stored = await storeAttachment(email, threadKey, pdf);
    if (!stored) {
      console.warn(`  Failed to store PDF: ${pdf.filename}`);
      continue;
    }

    // Check if this stored attachment already has analysis (from previous store)
    if (hasAnalysis(stored) && stored.analysisJson) {
      console.log(`  Using cached analysis for: ${stored.filename}`);
      return {
        filename: stored.filename,
        details: stored.analysisJson as PoDetails,
      };
    }

    // Analyze with Claude
    console.log(`  Analyzing PDF: ${pdf.filename} (${(pdf.content.length / 1024).toFixed(0)} KB)`);
    const details = await analyzePdfWithVision(pdf.content);

    if (details) {
      // Cache the analysis
      await updateAttachmentAnalysis(stored.id, {
        poNumber: details.poNumber,
        poTotal: details.total ? Math.round(details.total * 100) : null,
        analysisJson: details,
      });

      return { filename: pdf.filename, details };
    }
  }

  return null;
}
