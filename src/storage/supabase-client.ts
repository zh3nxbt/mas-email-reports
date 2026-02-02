import { createClient, SupabaseClient } from "@supabase/supabase-js";

const BUCKET_NAME = "po-attachments";

let supabaseClient: SupabaseClient | null = null;

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * Generate a storage path for a PO attachment
 * Format: 2026/01/emailId_filename.pdf
 */
export function generateStoragePath(
  emailId: number,
  filename: string,
  date: Date = new Date()
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  // Sanitize filename - remove special chars, keep extension
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${year}/${month}/${emailId}_${sanitized}`;
}

/**
 * Upload a PDF to Supabase Storage
 */
export async function uploadPdf(
  storagePath: string,
  content: Buffer,
  contentType: string = "application/pdf"
): Promise<{ path: string; error: string | null }> {
  const client = getClient();

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .upload(storagePath, content, {
      contentType,
      upsert: true, // Overwrite if exists
    });

  if (error) {
    return { path: "", error: error.message };
  }

  return { path: data.path, error: null };
}

/**
 * Download a PDF from Supabase Storage
 */
export async function downloadPdf(
  storagePath: string
): Promise<{ content: Buffer | null; error: string | null }> {
  const client = getClient();

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error) {
    return { content: null, error: error.message };
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return { content: buffer, error: null };
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(storagePath: string): Promise<boolean> {
  const client = getClient();

  // List files in the directory and check if our file exists
  const pathParts = storagePath.split("/");
  const filename = pathParts.pop()!;
  const directory = pathParts.join("/");

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .list(directory, { search: filename });

  if (error || !data) return false;
  return data.some((f) => f.name === filename);
}

/**
 * Delete a file from storage
 */
export async function deletePdf(
  storagePath: string
): Promise<{ error: string | null }> {
  const client = getClient();

  const { error } = await client.storage.from(BUCKET_NAME).remove([storagePath]);

  return { error: error?.message || null };
}

/**
 * Get a signed URL for temporary access (1 hour)
 */
export async function getSignedUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<{ url: string | null; error: string | null }> {
  const client = getClient();

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    return { url: null, error: error.message };
  }

  return { url: data.signedUrl, error: null };
}
