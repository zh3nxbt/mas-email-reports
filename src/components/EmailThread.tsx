"use client";

import { X, Mail, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Thread, Email, ThreadStatus } from "@/db/schema";

interface EmailThreadProps {
  thread: Thread;
  emails: Email[];
  loading: boolean;
  onClose: () => void;
  onStatusChange: (status: ThreadStatus) => void;
}

const statusOptions: { value: ThreadStatus; label: string }[] = [
  { value: "action_needed", label: "To Do" },
  { value: "quote_request", label: "Quote Request" },
  { value: "po_received", label: "PO Received" },
  { value: "no_action", label: "No Action Needed" },
];

export function EmailThread({
  thread,
  emails,
  loading,
  onClose,
  onStatusChange,
}: EmailThreadProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold text-lg">
              {thread.customerName || thread.customerEmail || "Unknown Customer"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {thread.subject || "(no subject)"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Status controls */}
        <div className="p-4 border-b bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Move to:</span>
            {statusOptions.map((option) => (
              <Button
                key={option.value}
                variant={thread.status === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => onStatusChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {thread.statusReason && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              AI reason: {thread.statusReason}
            </p>
          )}
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading emails...
            </div>
          ) : emails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No emails found
            </div>
          ) : (
            emails.map((email) => (
              <Card key={email.id} className="overflow-hidden">
                <CardHeader className="py-3 px-4 bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">
                          {email.fromName || email.fromAddress || "Unknown"}
                        </span>
                        <Badge
                          variant={
                            email.mailbox === "INBOX" ? "secondary" : "outline"
                          }
                          className="text-xs"
                        >
                          {email.mailbox === "INBOX" ? "Received" : "Sent"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        <span>To: {email.toAddresses || "Unknown"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDate(email.date)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <p className="text-sm whitespace-pre-wrap">
                    {email.bodyText || "(no content)"}
                  </p>
                  {email.hasAttachments && email.attachments && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Attachments:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {JSON.parse(email.attachments).map(
                          (att: { filename: string }, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {att.filename}
                            </Badge>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
