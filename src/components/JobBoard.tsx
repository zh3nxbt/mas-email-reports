"use client";

import { useState } from "react";
import { JobColumn } from "./JobColumn";
import { EmailThread } from "./EmailThread";
import type { Thread, Email } from "@/db/schema";

interface JobBoardProps {
  threads: (Thread & { latestEmailPreview?: string })[];
  onRefresh?: () => void;
}

export function JobBoard({ threads, onRefresh }: JobBoardProps) {
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadEmails, setThreadEmails] = useState<Email[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);

  // Group threads by status
  const todoThreads = threads.filter((t) => t.status === "action_needed");
  const quoteThreads = threads.filter((t) => t.status === "quote_request");
  const poThreads = threads.filter((t) => t.status === "po_received");

  const handleThreadClick = async (thread: Thread) => {
    setSelectedThread(thread);
    setLoadingEmails(true);

    try {
      const response = await fetch(`/api/threads/${thread.id}`);
      if (response.ok) {
        const data = await response.json();
        setThreadEmails(data.emails || []);
      }
    } catch (error) {
      console.error("Failed to load thread emails:", error);
    } finally {
      setLoadingEmails(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedThread) return;

    try {
      const response = await fetch(`/api/threads/${selectedThread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setSelectedThread(null);
        onRefresh?.();
      }
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  return (
    <div className="h-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
        <JobColumn
          title="To Do"
          threads={todoThreads}
          onThreadClick={handleThreadClick}
          color="blue"
        />
        <JobColumn
          title="Quote Requests"
          threads={quoteThreads}
          onThreadClick={handleThreadClick}
          color="yellow"
        />
        <JobColumn
          title="PO Received / Jobs"
          threads={poThreads}
          onThreadClick={handleThreadClick}
          color="green"
        />
      </div>

      {selectedThread && (
        <EmailThread
          thread={selectedThread}
          emails={threadEmails}
          loading={loadingEmails}
          onClose={() => setSelectedThread(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
