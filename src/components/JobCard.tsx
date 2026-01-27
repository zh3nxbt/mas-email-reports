"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import { Mail, Clock } from "lucide-react";
import type { Thread } from "@/db/schema";

interface JobCardProps {
  thread: Thread & { latestEmailPreview?: string };
  onClick?: () => void;
}

export function JobCard({ thread, onClick }: JobCardProps) {
  const statusBadgeVariant = {
    action_needed: "todo" as const,
    quote_request: "quote" as const,
    po_received: "po" as const,
    no_action: "secondary" as const,
    not_customer: "outline" as const,
  };

  const statusLabels = {
    action_needed: "To Do",
    quote_request: "Quote Request",
    po_received: "PO Received",
    no_action: "No Action",
    not_customer: "Not Customer",
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">
              {thread.customerName || thread.customerEmail || "Unknown"}
            </h4>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {thread.subject || "(no subject)"}
            </p>
          </div>
          <Badge variant={statusBadgeVariant[thread.status]} className="shrink-0">
            {statusLabels[thread.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {thread.latestEmailPreview && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {thread.latestEmailPreview}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {thread.emailCount} email{thread.emailCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(thread.lastActivity)}
          </span>
        </div>
        {thread.statusReason && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            {thread.statusReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
