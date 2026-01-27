import { ImapFlow } from "imapflow";

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  tlsRejectUnauthorized?: boolean;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function envInt(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envBool(name: string): boolean | undefined {
  const value = env(name);
  if (!value) return undefined;
  return value.toLowerCase() !== "false";
}

export function getDefaultMailbox(): string {
  return env("IMAP_MAILBOX") || "INBOX";
}

export function getImapConfig(): ImapConfig {
  const host = env("IMAP_HOST");
  const user = env("IMAP_USER");
  const pass = env("IMAP_PASS");
  if (!host || !user || !pass) {
    throw new Error(
      "Missing IMAP credentials. Set IMAP_HOST, IMAP_USER, and IMAP_PASS."
    );
  }

  const portRaw = env("IMAP_PORT");
  const port = portRaw ? Number(portRaw) : 993;
  const secure = envBool("IMAP_SECURE");
  const tlsRejectUnauthorized = envBool("IMAP_TLS_REJECT_UNAUTHORIZED");
  const connectTimeoutMs = envInt("IMAP_CONNECT_TIMEOUT_MS");
  const commandTimeoutMs = envInt("IMAP_COMMAND_TIMEOUT_MS");

  return {
    host,
    port,
    secure: secure ?? true,
    user,
    pass,
    tlsRejectUnauthorized,
    connectTimeoutMs,
    commandTimeoutMs,
  };
}

export function createImapClient(): ImapFlow {
  const config = getImapConfig();
  const options: any = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  };

  if (config.tlsRejectUnauthorized !== undefined) {
    options.tls = { rejectUnauthorized: config.tlsRejectUnauthorized };
  }
  if (config.connectTimeoutMs !== undefined) {
    options.connectionTimeout = config.connectTimeoutMs;
  }
  if (config.commandTimeoutMs !== undefined) {
    options.commandTimeout = config.commandTimeoutMs;
  }

  return new ImapFlow(options);
}

export async function withImapClient<T>(
  mailbox: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen(mailbox, { readOnly: true });
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function fetchBodyPart(
  client: ImapFlow,
  uid: number,
  partId: string
): Promise<Buffer | null> {
  const message = await client.fetchOne(
    uid,
    { bodyParts: [partId] } as any,
    { uid: true }
  );

  const bodyParts: any = (message as any)?.bodyParts;
  if (!bodyParts) {
    return null;
  }

  if (typeof bodyParts.get === "function") {
    return bodyParts.get(partId) || null;
  }

  return bodyParts[partId] ?? null;
}
