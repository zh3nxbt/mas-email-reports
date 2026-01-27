"use client";

import { JobCard } from "./JobCard";
import type { Thread } from "@/db/schema";

interface JobColumnProps {
  title: string;
  threads: (Thread & { latestEmailPreview?: string })[];
  onThreadClick?: (thread: Thread) => void;
  color: "blue" | "yellow" | "green";
}

const colorClasses = {
  blue: "border-t-blue-500 bg-blue-50/50",
  yellow: "border-t-yellow-500 bg-yellow-50/50",
  green: "border-t-green-500 bg-green-50/50",
};

const headerColors = {
  blue: "text-blue-700",
  yellow: "text-yellow-700",
  green: "text-green-700",
};

export function JobColumn({
  title,
  threads,
  onThreadClick,
  color,
}: JobColumnProps) {
  return (
    <div
      className={`flex flex-col rounded-lg border border-t-4 ${colorClasses[color]} min-h-[500px]`}
    >
      <div className="p-3 border-b bg-white/50">
        <h3 className={`font-semibold ${headerColors[color]}`}>
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({threads.length})
          </span>
        </h3>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No items
          </p>
        ) : (
          threads.map((thread) => (
            <JobCard
              key={thread.id}
              thread={thread}
              onClick={() => onThreadClick?.(thread)}
            />
          ))
        )}
      </div>
    </div>
  );
}
