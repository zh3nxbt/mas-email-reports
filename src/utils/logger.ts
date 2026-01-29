import fs from "fs";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), "logs");

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Log AI classification mismatches for monitoring
export function logAiMismatch(type: "po_pattern" | "rfq_pattern" | "category", details: {
  subject: string;
  aiResult: string;
  expectedResult: string;
  threadKey?: string;
}) {
  const timestamp = new Date().toISOString();
  const logFile = path.join(LOGS_DIR, "ai-mismatches.log");

  const logEntry = JSON.stringify({
    timestamp,
    type,
    ...details,
  }) + "\n";

  fs.appendFileSync(logFile, logEntry);
}

// Get recent AI mismatches for review
export function getRecentMismatches(limit: number = 50): Array<{
  timestamp: string;
  type: string;
  subject: string;
  aiResult: string;
  expectedResult: string;
}> {
  const logFile = path.join(LOGS_DIR, "ai-mismatches.log");

  if (!fs.existsSync(logFile)) {
    return [];
  }

  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines
    .slice(-limit)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
