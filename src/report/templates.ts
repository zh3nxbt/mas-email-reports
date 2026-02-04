import type { CategorizedThread, MorningReportData, DisplayTodo } from "./types";
import type { MiddayReportData } from "./generator";
import { getTodoPriority } from "./todo-analyzer";
import { formatPoDetailsDisplay } from "./po-detector";

// Outlook-compatible styles (minimal - most styling is inline)
// Outlook uses Word's rendering engine which doesn't support:
// - display: flex/none, border-radius, opacity, gap
// - CSS classes are often ignored
// Using tables for layout and inline styles for everything
const styles = `
  body {
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.5;
    color: #333333;
    margin: 0;
    padding: 16px;
    background-color: #f5f5f5;
  }
  table {
    border-collapse: collapse;
  }
  h1, h2, h3 {
    margin: 0;
  }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getThreadLabel(itemType: string): { text: string; class: string; color: string } {
  switch (itemType) {
    case "po_received":
      return { text: "PO Received", class: "po", color: "#059669" }; // green
    case "po_sent":
      return { text: "PO Sent", class: "po-sent", color: "#7c3aed" }; // purple
    case "quote_request":
      return { text: "RFQ", class: "rfq", color: "#2563eb" }; // blue
    default:
      return { text: "General", class: "", color: "#6b7280" }; // gray
  }
}

function formatTimestamp(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getLatestEmailDate(thread: CategorizedThread): Date | null {
  if (!thread.emails || thread.emails.length === 0) return null;
  let latest: Date | null = null;
  for (const email of thread.emails) {
    if (email.date && (!latest || email.date > latest)) {
      latest = email.date;
    }
  }
  return latest;
}

function renderThread(thread: CategorizedThread): string {
  const label = getThreadLabel(thread.itemType);
  const latestDate = getLatestEmailDate(thread);
  const timestamp = formatTimestamp(latestDate);

  // For po_received threads, show PO details or warning
  let poInfo = "";
  if (thread.itemType === "po_received") {
    if (thread.poDetails) {
      const poNumber = thread.poDetails.poNumber || "";
      const poTotal = thread.poDetails.total
        ? `$${thread.poDetails.total.toLocaleString()}`
        : "";
      const poDisplay = poNumber && poTotal
        ? `${poNumber} · ${poTotal}`
        : poNumber || poTotal || "";
      if (poDisplay) {
        poInfo = ` <span style="background-color: #d1fae5; color: #065f46; font-size: 11px; font-weight: bold; padding: 2px 6px;">[${escapeHtml(poDisplay)}]</span>`;
      }
    } else if (!thread.isSuspicious) {
      poInfo = ` <span style="background-color: #fef3c7; color: #92400e; font-size: 10px; font-weight: bold; padding: 2px 6px;">[Needs Review]</span>`;
    }
  }

  // For suspicious threads, show warning
  let suspiciousWarning = "";
  if (thread.isSuspicious) {
    suspiciousWarning = ` <span style="background-color: #fee2e2; color: #991b1b; font-size: 10px; font-weight: bold; padding: 2px 6px;">[Untrusted Domain]</span>`;
  }

  // Use table layout for Outlook compatibility
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #f0f0f0; margin-bottom: 8px;">
      <tr>
        <td width="80" valign="top" style="padding: 8px 12px 8px 0; font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${label.color};">
          ${label.text}
        </td>
        <td valign="top" style="padding: 8px 0;">
          <div style="font-weight: bold; color: #1a1a1a; font-size: 14px; margin-bottom: 2px;">
            ${escapeHtml(thread.subject)} <span style="background-color: #e5e7eb; color: #6b7280; font-size: 11px; font-weight: bold; padding: 1px 6px;">${thread.emailCount}</span>${poInfo}${suspiciousWarning}
          </div>
          <div style="font-size: 13px; color: #666666; margin-bottom: 4px;">
            ${escapeHtml(thread.contactName || thread.contactEmail || "Unknown")}${timestamp ? ` <span style="color: #9ca3af; font-size: 12px;">· ${timestamp}</span>` : ""}
          </div>
          ${thread.summary ? `<div style="font-size: 13px; color: #888888;">${escapeHtml(thread.summary)}</div>` : ""}
        </td>
      </tr>
    </table>
  `;
}

function getTodoLabel(todoType: string): { text: string; class: string } {
  switch (todoType) {
    case "po_unacknowledged":
      return { text: "Need to Ack PO", class: "urgent" };
    case "quote_unanswered":
      return { text: "Need to Send Quote", class: "pending" };
    case "general_unanswered":
      return { text: "Need to Reply", class: "pending" };
    case "vendor_followup":
      return { text: "Reply to Vendor", class: "pending" };
    default:
      return { text: "Action Needed", class: "pending" };
  }
}

function renderDisplayTodo(todo: DisplayTodo): string {
  const label = getTodoLabel(todo.todoType);
  const labelColor = todo.resolved ? "#888888" : (label.class === "urgent" ? "#dc2626" : "#d97706");
  const timestamp = formatTimestamp(todo.originalDate);
  const textStyle = todo.resolved ? "text-decoration: line-through; color: #888888;" : "";

  // Use table layout for Outlook compatibility - no buttons (they don't work in email)
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #f0f0f0; margin-bottom: 8px;">
      <tr>
        <td width="130" valign="top" style="padding: 8px 12px 8px 0; font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${labelColor};">
          ${label.text}${todo.resolved ? ' <span style="color: #16a34a;">✓</span>' : ""}
        </td>
        <td valign="top" style="padding: 8px 0;">
          <div style="font-weight: bold; font-size: 14px; margin-bottom: 2px; ${textStyle}">
            ${escapeHtml(todo.subject)}${todo.resolved ? ' <span style="color: #16a34a; font-size: 11px; font-weight: bold;">(resolved)</span>' : ""}
          </div>
          <div style="font-size: 13px; color: #666666; margin-bottom: 4px; ${textStyle}">
            ${escapeHtml(todo.contactName || todo.contactEmail || "Unknown")}${timestamp ? ` · ${timestamp}` : ""}
          </div>
          ${todo.description ? `<div style="font-size: 13px; color: #888888; ${textStyle}">${escapeHtml(todo.description)}</div>` : ""}
        </td>
      </tr>
    </table>
  `;
}

// Sort order for item types
const itemTypeSortOrder: Record<string, number> = {
  po_received: 1,
  po_sent: 1,
  quote_request: 2,
  general: 3,
  other: 4,
};

function sortThreadsByItemType(threads: CategorizedThread[]): CategorizedThread[] {
  return [...threads].sort((a, b) => {
    const orderA = itemTypeSortOrder[a.itemType] || 99;
    const orderB = itemTypeSortOrder[b.itemType] || 99;
    return orderA - orderB;
  });
}

function renderThreadSection(
  title: string,
  threads: CategorizedThread[]
): string {
  if (threads.length === 0) {
    return "";
  }

  const sorted = sortThreadsByItemType(threads);

  return `
    <div style="margin-bottom: 20px;">
      <h2 style="color: #666666; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0;">${title} (${threads.length})</h2>
      ${sorted.map(renderThread).join("")}
    </div>
  `;
}

// Generate daily summary HTML
export function generateDailySummaryHtml(
  date: Date,
  received: number,
  sent: number,
  threads: CategorizedThread[],
  todos: DisplayTodo[]
): string {
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Filter threads: only show NEW threads or threads needing action
  // Old threads where we just replied get moved to "ignored"
  const shouldShowThread = (t: CategorizedThread) => t.isNewThread || t.needsResponse;

  const customerThreads = threads.filter((t) => t.category === "customer" && shouldShowThread(t));
  const vendorThreads = threads.filter((t) => t.category === "vendor" && shouldShowThread(t));
  const otherThreads = threads.filter((t) => t.category === "other");

  // Threads that are old and handled (no action needed) - add to ignored
  const handledThreads = threads.filter((t) =>
    (t.category === "customer" || t.category === "vendor") && !shouldShowThread(t)
  );

  // Sort todos: pending first (oldest first), then resolved (oldest first)
  const sortedTodos = [...todos].sort((a, b) => {
    // First by resolved status (pending first)
    if (a.resolved !== b.resolved) {
      return a.resolved ? 1 : -1;
    }
    // Then by date (oldest first)
    const dateA = a.originalDate?.getTime() ?? 0;
    const dateB = b.originalDate?.getTime() ?? 0;
    return dateA - dateB;
  });

  // Combine "other" category and "handled old threads" into ignored
  const allIgnored = [...otherThreads, ...handledThreads];
  const ignoredNote = allIgnored.length > 0
    ? `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        <strong>Ignored (${allIgnored.length}):</strong>
        <ul style="margin: 8px 0 0 0; padding-left: 20px;">
          ${allIgnored.map(t => `<li>${escapeHtml(t.subject || "(no subject)")}</li>`).join("")}
        </ul>
      </div>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Report - ${dateStr}</title>
  <style>${styles}</style>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #333333; margin: 0; padding: 16px; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 700px; margin: 0 auto;">
    <tr>
      <td style="background-color: #ffffff; padding: 20px;">
        <h1 style="color: #1a1a1a; margin: 0 0 16px 0; font-size: 20px;">${dateStr} - Daily Summary</h1>
        <div style="font-size: 13px; color: #666666; margin-bottom: 16px;">
          12pm – 4pm · ${received} received, ${sent} sent
        </div>

        ${sortedTodos.length > 0 ? `
        <table width="100%" cellpadding="16" cellspacing="0" style="background-color: #fef3c7; border: 1px solid #f59e0b; margin-bottom: 24px;">
          <tr>
            <td>
              <h2 style="color: #92400e; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #f59e0b;">Action Items (${sortedTodos.filter(t => !t.resolved).length})</h2>
              ${sortedTodos.map(renderDisplayTodo).join("")}
            </td>
          </tr>
        </table>
        ` : ""}

        <table width="100%" cellpadding="16" cellspacing="0" style="background-color: #f9fafb;">
          <tr>
            <td>
              ${renderThreadSection("Customers", customerThreads)}
              ${renderThreadSection("Vendors", vendorThreads)}
            </td>
          </tr>
        </table>

        ${ignoredNote}

        <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999999; text-align: center;">
          12pm – 4pm · ${received} received, ${sent} sent
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Generate morning reminder HTML
export function generateMorningReminderHtml(data: MorningReportData, reportDate: Date): string {
  const dateStr = reportDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const unresolvedTodos = data.pendingTodos.filter(t => !t.resolved);

  // Convert pendingTodos to DisplayTodo format for renderDisplayTodo
  const displayTodos: DisplayTodo[] = data.pendingTodos.map(t => ({
    threadKey: t.threadKey,
    todoType: t.todoType,
    description: t.description || "",
    contactEmail: t.contactEmail,
    contactName: t.contactName,
    originalDate: t.originalDate,
    subject: t.subject || "",
    resolved: t.resolved || false,
  }));

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Morning Reminder - ${dateStr}</title>
  <style>${styles}</style>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #333333; margin: 0; padding: 16px; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 700px; margin: 0 auto;">
    <tr>
      <td style="background-color: #ffffff; padding: 20px;">
        <h1 style="color: #1a1a1a; margin: 0 0 16px 0; font-size: 20px;">${dateStr} - Morning To Do Reminder</h1>
        <div style="font-size: 13px; color: #666666; margin-bottom: 16px;">
          4pm – 7am · ${data.overnightReceived} received, ${data.overnightSent} sent overnight
        </div>

        ${unresolvedTodos.length > 0 ? `
        <table width="100%" cellpadding="16" cellspacing="0" style="background-color: #fef3c7; border: 1px solid #f59e0b; margin-bottom: 24px;">
          <tr>
            <td>
              <h2 style="color: #92400e; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #f59e0b;">Action Items (${unresolvedTodos.length})</h2>
              ${displayTodos.map(renderDisplayTodo).join("")}
            </td>
          </tr>
        </table>
        ` : `
        <div style="color: #999999; font-size: 13px; padding: 12px 0;">No pending items</div>
        `}

        ${(() => {
          // Filter threads: only show NEW threads or threads needing action
          const shouldShow = (t: CategorizedThread) => t.isNewThread || t.needsResponse;

          const overnightCustomers = data.overnightEmails.filter(t => t.category === "customer" && shouldShow(t));
          const overnightVendors = data.overnightEmails.filter(t => t.category === "vendor" && shouldShow(t));
          const overnightOther = data.overnightEmails.filter(t => t.category === "other");
          const overnightHandled = data.overnightEmails.filter(t =>
            (t.category === "customer" || t.category === "vendor") && !shouldShow(t)
          );

          if (data.overnightEmails.length === 0) return "";

          const allIgnored = [...overnightOther, ...overnightHandled];
          const ignoredNote = allIgnored.length > 0
            ? `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
                <strong>Ignored (${allIgnored.length}):</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                  ${allIgnored.map(t => `<li>${escapeHtml(t.subject || "(no subject)")}</li>`).join("")}
                </ul>
              </div>`
            : "";

          const totalShown = overnightCustomers.length + overnightVendors.length;
          return `
          <div style="margin-bottom: 20px;">
            <h2 style="color: #666666; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0;">Overnight (${totalShown})</h2>
            ${overnightCustomers.length > 0 ? `
              <h3 style="font-size: 14px; color: #666666; margin: 16px 0 8px 0;">Customers (${overnightCustomers.length})</h3>
              ${sortThreadsByItemType(overnightCustomers).map(renderThread).join("")}
            ` : ""}
            ${overnightVendors.length > 0 ? `
              <h3 style="font-size: 14px; color: #666666; margin: 16px 0 8px 0;">Vendors (${overnightVendors.length})</h3>
              ${sortThreadsByItemType(overnightVendors).map(renderThread).join("")}
            ` : ""}
            ${ignoredNote}
          </div>
          `;
        })()}

        <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999999; text-align: center;">
          4pm – 7am · ${data.overnightReceived} received, ${data.overnightSent} sent
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Generate midday report HTML
export function generateMiddayReportHtml(data: MiddayReportData, reportDate: Date): string {
  const dateStr = reportDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const unresolvedTodos = data.pendingTodos.filter(t => !t.resolved);

  // Convert pendingTodos to DisplayTodo format for renderDisplayTodo
  const displayTodos: DisplayTodo[] = data.pendingTodos.map(t => ({
    threadKey: t.threadKey,
    todoType: t.todoType,
    description: t.description || "",
    contactEmail: t.contactEmail,
    contactName: t.contactName,
    originalDate: t.originalDate,
    subject: t.subject || "",
    resolved: t.resolved || false,
  }));

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Midday Report - ${dateStr}</title>
  <style>${styles}</style>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #333333; margin: 0; padding: 16px; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 700px; margin: 0 auto;">
    <tr>
      <td style="background-color: #ffffff; padding: 20px;">
        <h1 style="color: #1a1a1a; margin: 0 0 16px 0; font-size: 20px;">${dateStr} - Midday Update</h1>
        <div style="font-size: 13px; color: #666666; margin-bottom: 16px;">
          7am – 12pm · ${data.morningReceived} received, ${data.morningSent} sent
        </div>

        ${unresolvedTodos.length > 0 ? `
        <table width="100%" cellpadding="16" cellspacing="0" style="background-color: #fef3c7; border: 1px solid #f59e0b; margin-bottom: 24px;">
          <tr>
            <td>
              <h2 style="color: #92400e; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #f59e0b;">Action Items (${unresolvedTodos.length})</h2>
              ${displayTodos.map(renderDisplayTodo).join("")}
            </td>
          </tr>
        </table>
        ` : `
        <div style="color: #999999; font-size: 13px; padding: 12px 0;">No pending items</div>
        `}

        ${(() => {
          // Filter threads: only show NEW threads or threads needing action
          const shouldShow = (t: CategorizedThread) => t.isNewThread || t.needsResponse;

          const morningCustomers = data.morningEmails.filter(t => t.category === "customer" && shouldShow(t));
          const morningVendors = data.morningEmails.filter(t => t.category === "vendor" && shouldShow(t));
          const morningOther = data.morningEmails.filter(t => t.category === "other");
          const morningHandled = data.morningEmails.filter(t =>
            (t.category === "customer" || t.category === "vendor") && !shouldShow(t)
          );

          if (data.morningEmails.length === 0) return "";

          const allIgnored = [...morningOther, ...morningHandled];
          const ignoredNote = allIgnored.length > 0
            ? `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
                <strong>Ignored (${allIgnored.length}):</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                  ${allIgnored.map(t => `<li>${escapeHtml(t.subject || "(no subject)")}</li>`).join("")}
                </ul>
              </div>`
            : "";

          const totalShown = morningCustomers.length + morningVendors.length;
          return `
          <div style="margin-bottom: 20px;">
            <h2 style="color: #666666; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0;">This Morning (${totalShown})</h2>
            ${morningCustomers.length > 0 ? `
              <h3 style="font-size: 14px; color: #666666; margin: 16px 0 8px 0;">Customers (${morningCustomers.length})</h3>
              ${sortThreadsByItemType(morningCustomers).map(renderThread).join("")}
            ` : ""}
            ${morningVendors.length > 0 ? `
              <h3 style="font-size: 14px; color: #666666; margin: 16px 0 8px 0;">Vendors (${morningVendors.length})</h3>
              ${sortThreadsByItemType(morningVendors).map(renderThread).join("")}
            ` : ""}
            ${ignoredNote}
          </div>
          `;
        })()}

        <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999999; text-align: center;">
          7am – 12pm · ${data.morningReceived} received, ${data.morningSent} sent
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Generate plain text version for console preview
export function generatePlainTextSummary(
  date: Date,
  received: number,
  sent: number,
  threads: CategorizedThread[],
  todos: DisplayTodo[]
): string {
  const lines: string[] = [];
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  lines.push(`\n${dateStr}`);
  lines.push(`${received} received, ${sent} sent\n`);

  // Show all todos: pending first (oldest first), then resolved (oldest first)
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.resolved !== b.resolved) {
      return a.resolved ? 1 : -1;
    }
    const dateA = a.originalDate?.getTime() ?? 0;
    const dateB = b.originalDate?.getTime() ?? 0;
    return dateA - dateB;
  });

  if (sortedTodos.length > 0) {
    lines.push(`ACTION ITEMS:`);
    for (const todo of sortedTodos) {
      const marker = todo.resolved ? "[x]" : "[ ]";
      const timestamp = todo.originalDate ? todo.originalDate.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) : "";
      lines.push(`  ${marker} ${todo.subject}`);
      lines.push(`      ${todo.contactName || todo.contactEmail || "Unknown"}${timestamp ? ` · ${timestamp}` : ""}`);
    }
    lines.push("");
  }

  // Filter threads: only show NEW threads or threads needing action
  const shouldShowThread = (t: CategorizedThread) => t.isNewThread || t.needsResponse;

  const customerThreads = threads.filter((t) => t.category === "customer" && shouldShowThread(t));
  const vendorThreads = threads.filter((t) => t.category === "vendor" && shouldShowThread(t));
  const ignoredThreads = threads.filter((t) =>
    t.category === "other" || ((t.category === "customer" || t.category === "vendor") && !shouldShowThread(t))
  );

  if (customerThreads.length > 0) {
    lines.push(`CUSTOMERS:`);
    for (const thread of customerThreads) {
      let poInfo = "";
      if (thread.itemType === "po_received") {
        if (thread.poDetails) {
          const poNumber = thread.poDetails.poNumber || "";
          const poTotal = thread.poDetails.total ? `$${thread.poDetails.total.toLocaleString()}` : "";
          poInfo = poNumber || poTotal ? ` [PO: ${poNumber}${poNumber && poTotal ? " " : ""}${poTotal}]` : "";
        } else if (!thread.isSuspicious) {
          poInfo = " [NEEDS REVIEW]";
        } else {
          poInfo = " [UNTRUSTED DOMAIN]";
        }
      }
      lines.push(`  ${thread.subject}${poInfo}`);
      lines.push(`      ${thread.contactName || thread.contactEmail || "Unknown"}`);
      if (thread.summary) lines.push(`      ${thread.summary}`);
    }
    lines.push("");
  }

  if (vendorThreads.length > 0) {
    lines.push(`VENDORS:`);
    for (const thread of vendorThreads) {
      lines.push(`  ${thread.subject}`);
      lines.push(`      ${thread.contactName || thread.contactEmail || "Unknown"}`);
      if (thread.summary) lines.push(`      ${thread.summary}`);
    }
    lines.push("");
  }

  if (ignoredThreads.length > 0) {
    lines.push(`IGNORED:`);
    for (const thread of ignoredThreads) {
      lines.push(`  ${thread.subject}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
