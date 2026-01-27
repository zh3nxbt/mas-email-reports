"use client";

import { useEffect, useState, useCallback } from "react";
import { JobBoard } from "@/components/JobBoard";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, ChevronDown } from "lucide-react";
import type { Thread } from "@/db/schema";

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function Dashboard() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  const fetchThreads = useCallback(async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      // Fetch active threads (visible on Kanban) with higher limit
      const response = await fetch(
        `/api/threads?status=action_needed,quote_request,po_received&page=${page}&limit=50`
      );
      if (!response.ok) throw new Error("Failed to fetch threads");

      const data = await response.json();

      if (append && page > 1) {
        setThreads((prev) => [...prev, ...(data.threads || [])]);
      } else {
        setThreads(data.threads || []);
      }

      setPagination(data.pagination || null);
      setError(null);
    } catch (err) {
      setError("Failed to load threads");
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const handleLoadMore = () => {
    if (pagination && pagination.page < pagination.totalPages) {
      fetchThreads(pagination.page + 1, true);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Sync failed");
      }
      setLastSync(new Date());
      await fetchThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchThreads();

    // Auto-refresh every 60 seconds
    const interval = setInterval(() => fetchThreads(), 60000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  const hasMore = pagination && pagination.page < pagination.totalPages;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Job Flow Tracker
            </h1>
            <p className="text-sm text-muted-foreground">
              Email-based job tracking dashboard
              {pagination && (
                <span className="ml-2">
                  ({pagination.total} total threads)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {lastSync && (
              <span className="text-sm text-muted-foreground">
                Last sync: {lastSync.toLocaleTimeString()}
              </span>
            )}
            <Button onClick={handleSync} disabled={syncing}>
              {syncing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sync Emails
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-6 mt-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground mb-4">
              No threads found. Click "Sync Emails" to fetch your emails.
            </p>
            <Button onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync Emails"}
            </Button>
          </div>
        ) : (
          <>
            <JobBoard threads={threads} onRefresh={() => fetchThreads()} />

            {/* Load More button */}
            {hasMore && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Load More ({pagination.total - threads.length} remaining)
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
