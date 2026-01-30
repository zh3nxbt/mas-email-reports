/**
 * Trusted Domain Filter for QuickBooks Job Sync
 *
 * Prevents processing emails/PDFs from suspicious domains by:
 * 1. Automatically trusting domains we've emailed (from sent folder)
 * 2. Supporting a manual whitelist via TRUSTED_DOMAINS env var
 *
 * This protects against:
 * - Analyzing infected PDF attachments from phishing emails
 * - Wasting API calls matching phishing emails to QB customers
 */

import { db } from "../db/index.js";
import { emails } from "../db/schema.js";
import { sql } from "drizzle-orm";

/**
 * Extract domain from an email address
 * Returns lowercase domain or null if invalid
 */
export function extractDomain(email: string): string | null {
  const match = email.match(/@([^@\s]+)$/);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Parse recipient addresses from email toAddresses field
 * The field stores a JSON array of addresses
 */
function parseRecipients(toAddresses: string | null): string[] {
  if (!toAddresses) return [];
  try {
    const parsed = JSON.parse(toAddresses);
    if (Array.isArray(parsed)) {
      return parsed.filter((addr): addr is string => typeof addr === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Get domains from sent email recipients in the database
 * These are domains we've actively communicated with
 */
async function getSentEmailDomains(): Promise<Set<string>> {
  const domains = new Set<string>();

  // Query sent emails and extract recipient domains
  const sentEmails = await db
    .select({ toAddresses: emails.toAddresses })
    .from(emails)
    .where(sql`${emails.mailbox} IN ('Sent', 'INBOX.Sent', 'INBOX.Sent Messages', 'Sent Messages')`);

  for (const email of sentEmails) {
    const recipients = parseRecipients(email.toAddresses);
    for (const recipient of recipients) {
      const domain = extractDomain(recipient);
      if (domain) {
        domains.add(domain);
      }
    }
  }

  return domains;
}

/**
 * Get manually whitelisted domains from TRUSTED_DOMAINS env var
 * Format: comma-separated list of domains
 * Example: TRUSTED_DOMAINS=newvendor.com,legitcustomer.ca
 */
function getManualWhitelist(): Set<string> {
  const domains = new Set<string>();
  const envValue = process.env.TRUSTED_DOMAINS;

  if (!envValue) return domains;

  const parts = envValue.split(",");
  for (const part of parts) {
    const domain = part.trim().toLowerCase();
    if (domain) {
      domains.add(domain);
    }
  }

  return domains;
}

/**
 * Build the complete set of trusted domains
 * Combines:
 * 1. Domains from sent email recipients (automatic trust)
 * 2. Manual whitelist from TRUSTED_DOMAINS env var
 */
export async function getTrustedDomains(): Promise<Set<string>> {
  const [sentDomains, manualDomains] = await Promise.all([
    getSentEmailDomains(),
    Promise.resolve(getManualWhitelist()),
  ]);

  // Combine both sets
  const trusted = new Set<string>(sentDomains);
  for (const domain of manualDomains) {
    trusted.add(domain);
  }

  return trusted;
}

/**
 * Check if an email address belongs to a trusted domain
 */
export function isDomainTrusted(email: string, trustedDomains: Set<string>): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return trustedDomains.has(domain);
}

/**
 * Filter a list of email addresses to only trusted ones
 */
export function filterTrustedEmails(
  emailAddresses: string[],
  trustedDomains: Set<string>
): string[] {
  return emailAddresses.filter((email) => isDomainTrusted(email, trustedDomains));
}

/**
 * Get statistics about trusted domains for debugging/logging
 */
export async function getTrustedDomainsStats(): Promise<{
  totalTrusted: number;
  fromSentEmails: number;
  fromManualWhitelist: number;
  domains: string[];
}> {
  const sentDomains = await getSentEmailDomains();
  const manualDomains = getManualWhitelist();

  const allDomains = new Set<string>(sentDomains);
  for (const domain of manualDomains) {
    allDomains.add(domain);
  }

  return {
    totalTrusted: allDomains.size,
    fromSentEmails: sentDomains.size,
    fromManualWhitelist: manualDomains.size,
    domains: Array.from(allDomains).sort(),
  };
}
