import { htmlToText } from "html-to-text";

type Address = { name?: string; address?: string };

type BodyNode = {
  part?: string;
  type?: string;
  subtype?: string;
  size?: number;
  encoding?: string;
  params?: Record<string, string>;
  parameters?: Record<string, string>;
  disposition?: any;
  childNodes?: BodyNode[];
};

export type AttachmentInfo = {
  filename: string;
  contentType: string;
  size?: number;
};

export function formatAddressList(addresses?: Address[] | null): string {
  if (!addresses || addresses.length === 0) {
    return "";
  }

  return addresses
    .map((addr) => {
      if (!addr) return "";
      const name = addr.name?.trim();
      const email = addr.address?.trim();
      if (name && email) {
        return `${name} <${email}>`;
      }
      return name || email || "";
    })
    .filter(Boolean)
    .join(", ");
}

export function sanitizeSubject(subject?: string | null): string {
  if (!subject || subject.trim().length === 0) {
    return "(no subject)";
  }
  return subject.trim();
}

export function makeSnippet(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}?`;
}

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

function getParams(node: BodyNode): Record<string, string> {
  return node.params || node.parameters || {};
}

function getFilename(node: BodyNode): string | undefined {
  const disposition = normalizeDisposition(node.disposition);
  const params = getParams(node);
  return (
    disposition.params?.filename ||
    params.name ||
    params.filename ||
    disposition.params?.name
  );
}

export function flattenBodyStructure(node?: BodyNode): BodyNode[] {
  if (!node) return [];
  const nodes: BodyNode[] = [node];
  if (node.childNodes && node.childNodes.length > 0) {
    for (const child of node.childNodes) {
      nodes.push(...flattenBodyStructure(child));
    }
  }
  return nodes;
}

// Helper to check MIME type - handles both separate (type/subtype) and combined ("text/plain") formats
function isTextPlain(node: BodyNode): boolean {
  if (node.type === "text" && node.subtype === "plain") return true;
  if (node.type === "text/plain") return true;
  return false;
}

function isTextHtml(node: BodyNode): boolean {
  if (node.type === "text" && node.subtype === "html") return true;
  if (node.type === "text/html") return true;
  return false;
}

export function findTextPart(
  structure?: BodyNode
): { part: string; isHtml: boolean; encoding?: string } | null {
  if (!structure) return null;

  // Handle simple single-part emails (no childNodes, root is the text)
  // These don't have a part field - use "1" to fetch the body
  if (!structure.childNodes || structure.childNodes.length === 0) {
    if (isTextPlain(structure)) {
      return { part: structure.part || "1", isHtml: false, encoding: structure.encoding };
    }
    if (isTextHtml(structure)) {
      return { part: structure.part || "1", isHtml: true, encoding: structure.encoding };
    }
  }

  // Handle multipart emails
  const nodes = flattenBodyStructure(structure);
  const plain = nodes.find(
    (node) => node.part && isTextPlain(node) && !isAttachment(node)
  );
  if (plain?.part) {
    return { part: plain.part, isHtml: false, encoding: plain.encoding };
  }
  const html = nodes.find(
    (node) => node.part && isTextHtml(node) && !isAttachment(node)
  );
  if (html?.part) {
    return { part: html.part, isHtml: true, encoding: html.encoding };
  }
  return null;
}

export function extractAttachments(structure?: BodyNode): AttachmentInfo[] {
  const nodes = flattenBodyStructure(structure);
  const attachments: AttachmentInfo[] = [];
  for (const node of nodes) {
    const filename = getFilename(node);
    if (!filename) continue;
    const contentType = `${node.type || "application"}/${node.subtype || "octet-stream"}`;
    attachments.push({
      filename,
      contentType,
      size: node.size,
    });
  }
  return attachments;
}

export function isAttachment(node: BodyNode): boolean {
  const disposition = normalizeDisposition(node.disposition);
  if (disposition.type && disposition.type.toLowerCase() === "attachment") {
    return true;
  }
  return Boolean(getFilename(node));
}

function decodeQuotedPrintable(input: string): string {
  return input
    // Handle soft line breaks (= at end of line)
    .replace(/=\r?\n/g, "")
    // Decode =XX hex sequences
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

export function decodeBodyText(
  buffer: Buffer,
  isHtml: boolean,
  includeHtmlAsText: boolean,
  encoding?: string
): string {
  let raw: string;

  const enc = encoding?.toLowerCase();
  if (enc === "base64") {
    // Decode base64
    raw = Buffer.from(buffer.toString("ascii").replace(/\s/g, ""), "base64").toString("utf8");
  } else if (enc === "quoted-printable") {
    // Decode quoted-printable
    raw = decodeQuotedPrintable(buffer.toString("ascii"));
  } else {
    // 7bit, 8bit, or binary - just convert to string
    raw = buffer.toString("utf8");
  }

  if (!isHtml) {
    return raw;
  }
  if (!includeHtmlAsText) {
    return "";
  }
  return htmlToText(raw, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  });
}

export function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
