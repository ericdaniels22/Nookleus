"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { format, isToday, isYesterday } from "date-fns";
import {
  Inbox,
  Trash2,
  Archive,
  Star,
  Search,
  RefreshCw,
  Paperclip,
  Briefcase,
  MailCheck,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Email, EmailAccount } from "@/lib/types";
import EmailReader from "@/components/email-reader";
import ComposeEmailModal from "@/components/compose-email";
import IconRail from "@/components/email/icon-rail";
import CategoryTabs, { type CategoryFilter } from "@/components/email/category-tabs";
import { buildReplyComposeSeed, type ReplyKind } from "@/components/email/reply-compose-seed";
import {
  restoreDraftAttachments,
  type DraftAttachmentInput,
} from "@/lib/email/draft-attachments";
import { useEmailSync } from "@/lib/email/use-email-sync";
import { useEmailSummaryCache } from "@/lib/mobile/use-email-summary-cache";

const LAZY_REFRESH_FOLDERS = new Set(["drafts", "trash", "spam", "archive"]);
const LAZY_REFRESH_THROTTLE_MS = 30_000;

interface FolderCounts {
  [key: string]: { total: number; unread: number };
}

interface ListResponse {
  emails: Email[];
  total: number;
  page: number;
  hasMore: boolean;
}


function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

export default function EmailInbox() {
  const [folder, setFolder] = useState("inbox");
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [counts, setCounts] = useState<FolderCounts>({});

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Category filter (inbox only)
  const [category, setCategory] = useState<CategoryFilter>("general");
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({
    general: 0,
    promotions: 0,
    social: 0,
    purchases: 0,
    starred: 0,
  });

  // Resizable pane widths. Initialize with the default on both server and
  // client to avoid hydration mismatch, then hydrate from localStorage in
  // an effect after mount.
  const [listWidth, setListWidth] = useState(384);
  const listWidthHydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("email-pane-widths");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.list === "number") {
          setListWidth(parsed.list);
        }
      }
    } catch {}
    listWidthHydrated.current = true;
  }, []);

  // Persist list width to localStorage (skip the initial render before
  // we've hydrated from localStorage, to avoid writing the default over
  // the saved value).
  useEffect(() => {
    if (!listWidthHydrated.current) return;
    try {
      localStorage.setItem(
        "email-pane-widths",
        JSON.stringify({ list: listWidth })
      );
    } catch {}
  }, [listWidth]);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === emails.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bulk actions
  const [bulkLoading, setBulkLoading] = useState(false);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<{ id: string; job_number: string; property_address: string }[]>([]);
  const jobPickerRef = useRef<HTMLDivElement>(null);

  async function executeBulkAction(action: string, jobId?: string) {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/email/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), action, jobId }),
      });
      if (!res.ok) throw new Error("Bulk action failed");
      const data = await res.json();
      toast.success(`Updated ${data.updated} email${data.updated !== 1 ? "s" : ""}`);
      clearSelection();
      loadEmails();
      loadCounts();
    } catch {
      toast.error("Bulk action failed");
    }
    setBulkLoading(false);
    setJobPickerOpen(false);
  }

  // Debounced job search for picker
  useEffect(() => {
    if (!jobPickerOpen || jobSearch.length < 1) {
      setJobResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jobs/search?q=${encodeURIComponent(jobSearch)}&limit=8`);
        const data = await res.json();
        setJobResults(data.jobs || []);
      } catch {
        setJobResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [jobSearch, jobPickerOpen]);

  // Close job picker on outside click
  useEffect(() => {
    if (!jobPickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (jobPickerRef.current && !jobPickerRef.current.contains(e.target as Node)) {
        setJobPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [jobPickerOpen]);

  // Clear selection when navigating
  useEffect(() => {
    setSelectedIds(new Set());
  }, [folder, selectedAccountId, searchDebounced, page]);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"compose" | "reply" | "forward">("compose");
  const [replyTo, setReplyTo] = useState<{
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    messageId: string;
    jobId: string;
    draftId?: string;
    accountId?: string;
    attachments?: DraftAttachmentInput[];
  } | null>(null);

  // Consume query params on mount:
  // - `compose=1` opens the composer (e.g. the AR aging Nudge button).
  // - `account` / `id` are the iOS Emails widget (#174) deep links — tapping
  //   the unread count opens that account's inbox; tapping a preview opens
  //   that specific email.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      const subject = searchParams.get("subject") || "";
      const body = searchParams.get("body") || "";
      const jobId = searchParams.get("jobId") || "";
      setComposeMode("compose");
      setReplyTo({
        to: "",
        cc: "",
        bcc: "",
        subject,
        body,
        messageId: "",
        jobId,
      });
      setComposeOpen(true);
    }

    const widgetAccountId = searchParams.get("account");
    if (widgetAccountId) setSelectedAccountId(widgetAccountId);

    const widgetEmailId = searchParams.get("id");
    if (widgetEmailId) setSelectedEmailId(widgetEmailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load accounts on mount
  useEffect(() => {
    fetch("/api/email/accounts")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          const active = data.filter((a: EmailAccount) => a.is_active);
          setAccounts(active);
        }
      })
      .catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [loadingMore, setLoadingMore] = useState(false);

  // Load emails when folder, account, search, or page changes
  const loadEmails = useCallback(async () => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (folder === "starred") {
        params.set("starred", "true");
      } else {
        params.set("folder", folder);
      }
      if (selectedAccountId) params.set("accountId", selectedAccountId);
      if (searchDebounced) params.set("search", searchDebounced);
      params.set("page", page.toString());
      if (folder === "inbox") params.set("category", category);

      const res = await fetch(`/api/email/list?${params}`);
      const data: ListResponse = await res.json();
      setEmails((prev) => {
        const merged = page === 1 ? data.emails : [...prev, ...data.emails];
        const byId = new Map<string, Email>();
        for (const e of merged) byId.set(e.id, e);
        return Array.from(byId.values());
      });
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      toast.error("Failed to load emails");
    }
    setLoading(false);
    setLoadingMore(false);
  }, [folder, selectedAccountId, searchDebounced, page, category]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  // Cache the loaded inbox summary for the iOS Emails widget (#173). No-op
  // off the native shell; paused on non-inbox folders so the cache keeps its
  // last inbox snapshot.
  useEmailSummaryCache(emails, accounts, folder === "inbox");

  // Infinite scroll: bump page when sentinel enters view
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading || loadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, emails.length]);

  // Load folder counts
  const loadCounts = useCallback(async () => {
    try {
      const params = selectedAccountId
        ? `?accountId=${selectedAccountId}`
        : "";
      const res = await fetch(`/api/email/counts${params}`);
      const data = await res.json();
      setCounts(data);
      if (data.categoryUnread) {
        setCategoryCounts(data.categoryUnread);
      }
    } catch {
      // silent
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Refresh accounts (to pick up new last_synced_at after a sync).
  const refreshAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/email/accounts");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setAccounts(data.filter((a: EmailAccount) => a.is_active));
      }
    } catch {
      // silent — indicator just stays stale until next refresh
    }
  }, []);

  // doSync = the work a sync click (or auto-sync) actually performs.
  // Multi-account fan-out in parallel, then refresh UI state.
  const doSync = useCallback(async () => {
    const toSync = selectedAccountId
      ? accounts.filter((a) => a.id === selectedAccountId)
      : accounts;
    if (toSync.length === 0) return;

    let totalSynced = 0;
    const failures: string[] = [];
    const results = await Promise.allSettled(
      toSync.map((acc) =>
        fetch("/api/email/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: acc.id }),
        })
          .then((res) => res.json())
          .then((data: { total_synced?: number }) => ({
            acc,
            synced: data.total_synced ?? 0,
          })),
      ),
    );
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") {
        totalSynced += r.value.synced;
      } else {
        failures.push(toSync[i]?.label ?? "account");
      }
    }
    if (failures.length > 0) {
      // Bubble up so hook flags syncFailed and Sync click bubbles via try/catch.
      throw new Error(`sync failed for ${failures.join(", ")}`);
    }
    // Toast only on visible sync. The hook's `syncing` state distinguishes
    // visible from silent — but `doSync` doesn't see that flag. Spec says
    // silent failures should not toast either way. Skip toasts here; let
    // the indicator and spinner communicate freshness.
    void totalSynced; // intentionally unused — value is observed via list/counts refresh

    await Promise.all([loadEmails(), loadCounts(), refreshAccounts()]);
  }, [accounts, selectedAccountId, loadEmails, loadCounts, refreshAccounts]);

  const { syncing, lastSyncedAt, syncFailed, syncSilent, syncVisible } =
    useEmailSync({
      accounts,
      selectedAccountId: selectedAccountId || null,
      doSync,
      autoSync: false, // parent triggers once accounts have loaded
    });

  // Auto-sync once after accounts arrive, respecting the 60s debounce.
  const hasAutoSynced = useRef(false);
  useEffect(() => {
    if (hasAutoSynced.current || accounts.length === 0) return;
    hasAutoSynced.current = true;

    const now = Date.now();
    const recentlySynced = accounts.some((acc) => {
      if (!acc.last_synced_at) return false;
      return now - new Date(acc.last_synced_at).getTime() < 60_000;
    });
    if (!recentlySynced) {
      void syncSilent();
    }
  }, [accounts, syncSilent]);

  // Sync button handler — promotes any in-flight silent sync to visible.
  const handleSync = useCallback(async () => {
    try {
      await syncVisible();
    } catch {
      // syncFailed already flagged by the hook; visible toast for the click.
      toast.error("Sync failed");
    }
  }, [syncVisible]);

  // Mark all as read
  async function handleMarkAllRead() {
    try {
      await fetch("/api/email/mark-all-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder,
          accountId: selectedAccountId || undefined,
        }),
      });
      setEmails((prev) => prev.map((e) => ({ ...e, is_read: true })));
      loadCounts();
      toast.success("All marked as read");
    } catch {
      toast.error("Failed to mark all as read");
    }
  }

  // Toggle star
  async function handleStarToggle(id: string, starred: boolean) {
    await fetch(`/api/email/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_starred: starred }),
    });
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_starred: starred } : e))
    );
    loadCounts();
  }

  // Mark read/unread
  async function handleReadToggle(id: string, read: boolean) {
    await fetch(`/api/email/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_read: read }),
    });
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_read: read } : e))
    );
    loadCounts();
  }

  // Open email (or resume draft)
  function handleSelectEmail(email: Email) {
    if (folder === "drafts") {
      // Resume draft in compose modal
      const toList = (email.to_addresses || []).map((a) => a.email).join(", ");
      const ccList = (email.cc_addresses || []).map((a) => a.email).join(", ");
      const bccList = (email.bcc_addresses || []).map((a) => a.email).join(", ");
      setComposeMode("compose");
      setReplyTo({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: email.subject,
        body: email.body_html || email.body_text || "",
        messageId: email.thread_id || "",
        jobId: email.job_id || "",
        draftId: email.id,
        accountId: email.account_id,
        // Re-hydrate the draft's persisted attachments so the chips reappear
        // and the files re-send (issue #663).
        attachments: restoreDraftAttachments(email.attachments),
      });
      setComposeOpen(true);
      return;
    }
    setSelectedEmailId(email.id);
    if (!email.is_read) {
      handleReadToggle(email.id, true);
    }
  }

  // Reply / Reply-All / Forward all funnel through one seed builder so the
  // reply goes out from the account that *received* the message, not whatever
  // account is the compose default (issue #660).
  function launchReplyCompose(email: Email, kind: ReplyKind) {
    const { mode, ...seed } = buildReplyComposeSeed(
      email,
      kind,
      accounts.map((a) => a.email_address),
    );
    setComposeMode(mode);
    setReplyTo(seed);
    setComposeOpen(true);
  }

  // Reply
  function handleReply(email: Email) {
    launchReplyCompose(email, "reply");
  }

  // Reply All
  function handleReplyAll(email: Email) {
    launchReplyCompose(email, "reply-all");
  }

  // Forward
  function handleForward(email: Email) {
    launchReplyCompose(email, "forward");
  }

  // New compose
  function handleCompose() {
    setComposeMode("compose");
    setReplyTo(null);
    setComposeOpen(true);
  }

  // Per-folder timestamp so we don't thrash sync-folder on rapid tab flips.
  const lazyRefreshTsRef = useRef<Map<string, number>>(new Map());

  function handleFolderChange(key: string) {
    setFolder(key);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
    setCategory("general");

    if (!LAZY_REFRESH_FOLDERS.has(key)) return;
    const last = lazyRefreshTsRef.current.get(key) ?? 0;
    if (Date.now() - last < LAZY_REFRESH_THROTTLE_MS) return;
    lazyRefreshTsRef.current.set(key, Date.now());
    fetch("/api/email/sync-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: key,
        accountId: selectedAccountId || undefined,
      }),
    })
      .then(() => {
        loadEmails();
        loadCounts();
      })
      .catch(() => {
        // silent: existing rows still render; user can hit Sync explicitly
      });
  }

  function handleCategoryChange(cat: CategoryFilter) {
    setCategory(cat);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
  }

  const accountColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      if (a.color) map.set(a.id, a.color);
    }
    return map;
  }, [accounts]);
  // Bar appears once there's more than one connected account to distinguish.
  const showAccountBar = accounts.length >= 2;

  return (
    <div className="h-[calc(100dvh-env(safe-area-inset-top)-3.5rem)] lg:h-dvh flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
        <h1 className="text-lg font-bold text-foreground mr-2">Email</h1>

        {/* Account filter */}
        <div className="relative">
          <select
            value={selectedAccountId}
            onChange={(e) => {
              setSelectedAccountId(e.target.value);
              setPage(1);
            }}
            className="text-sm border border-border rounded-lg pl-3 pr-8 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
            suppressHydrationWarning
          >
            <option value="">All Inboxes</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
        </div>

        {/* Search */}
        <div className="flex-1 max-w-md relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <LastSyncedIndicator
            syncing={syncing}
            lastSyncedAt={lastSyncedAt}
            syncFailed={syncFailed}
            onRetry={handleSync}
            accountsLoaded={accounts.length > 0}
            scopeAccounts={accounts}
            selectedAccountId={selectedAccountId}
          />
          <button
            onClick={handleSync}
            disabled={syncing || accounts.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={syncing ? "animate-spin" : ""}
            />
            {syncing ? "Syncing..." : "Sync"}
          </button>
          <a
            href="/settings/email"
            className="p-1.5 text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent rounded"
            title="Email Settings"
          >
            <Settings size={16} />
          </a>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Column 1: Icon rail */}
        <IconRail
          folder={folder}
          counts={counts}
          onFolderChange={handleFolderChange}
          onCompose={handleCompose}
        />

        {/* Column 2: Email list */}
        <div
          style={{ width: listWidth }}
          className={`border-r border-border flex flex-col bg-card shrink-0 ${
            selectedEmailId ? "hidden lg:flex" : "flex"
          }`}
        >
          {folder === "inbox" && (
            <CategoryTabs
              category={category}
              categoryCounts={categoryCounts}
              onChange={handleCategoryChange}
            />
          )}

          {/* List header / Bulk action bar */}
          <div className="px-4 py-2 border-b border-border/50 text-xs text-muted-foreground/60 flex items-center justify-between">
            {selectedIds.size > 0 ? (
              <>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === emails.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border accent-primary"
                  />
                  <span className="font-medium text-foreground">
                    {selectedIds.size} selected
                  </span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const allRead = emails
                        .filter((e) => selectedIds.has(e.id))
                        .every((e) => e.is_read);
                      executeBulkAction(allRead ? "mark_unread" : "mark_read");
                    }}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Toggle read/unread"
                  >
                    <MailCheck size={14} />
                  </button>
                  <button
                    onClick={() => executeBulkAction("archive")}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Archive"
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    onClick={() => executeBulkAction("trash")}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className="relative" ref={jobPickerRef}>
                    <button
                      onClick={() => {
                        setJobPickerOpen(!jobPickerOpen);
                        setJobSearch("");
                        setJobResults([]);
                      }}
                      disabled={bulkLoading}
                      className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                      title="Assign to job"
                    >
                      <Briefcase size={14} />
                    </button>
                    {jobPickerOpen && (
                      <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 p-2">
                        <input
                          type="text"
                          placeholder="Search jobs..."
                          value={jobSearch}
                          onChange={(e) => setJobSearch(e.target.value)}
                          autoFocus
                          className="w-full px-2 py-1.5 text-sm border border-border rounded mb-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <div className="max-h-48 overflow-y-auto">
                          {jobResults.length === 0 && jobSearch.length > 0 && (
                            <p className="text-xs text-muted-foreground/60 px-2 py-2">No jobs found</p>
                          )}
                          {jobResults.map((job) => (
                            <button
                              key={job.id}
                              onClick={() => executeBulkAction("assign_job", job.id)}
                              className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded flex items-center gap-2"
                            >
                              <span className="font-medium text-primary">{job.job_number}</span>
                              <span className="truncate text-muted-foreground">{job.property_address}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={clearSelection}
                    className="px-2 py-1 rounded hover:bg-accent ml-1"
                    title="Clear selection"
                  >
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={emails.length > 0 && selectedIds.size === emails.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border accent-primary"
                  />
                  {total} email{total !== 1 ? "s" : ""}
                  {folder !== "starred" && counts[folder]?.unread ? (
                    <span className="text-primary bg-primary/10 rounded-full px-1.5 py-0.5 text-[11px] font-medium">
                      {counts[folder].unread} unread
                    </span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  {counts[folder]?.unread > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="flex items-center gap-1 text-primary hover:underline"
                      title="Mark all as read"
                    >
                      <MailCheck size={12} />
                      Mark all read
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Email rows */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground/60 text-sm">
                Loading...
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
                <Inbox size={32} className="mb-2 opacity-40" />
                <p className="text-sm">No emails</p>
              </div>
            ) : (
              emails.map((email) => (
                <EmailRow
                  key={email.id}
                  email={email}
                  isSelected={email.id === selectedEmailId}
                  isChecked={selectedIds.has(email.id)}
                  folder={folder}
                  accountColor={accountColorById.get(email.account_id)}
                  showAccountBar={showAccountBar}
                  onSelect={() => handleSelectEmail(email)}
                  onStar={() =>
                    handleStarToggle(email.id, !email.is_starred)
                  }
                  onToggleCheck={() => toggleSelect(email.id)}
                />
              ))
            )}

            {/* Infinite scroll sentinel */}
            {!loading && hasMore && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center py-3 text-xs text-muted-foreground/60"
              >
                {loadingMore ? "Loading more…" : ""}
              </div>
            )}
          </div>
        </div>

        <ResizeHandle
          onResize={(delta) => {
            setListWidth((prev: number) => Math.min(600, Math.max(280, prev + delta)));
          }}
        />

        {/* Column 3: Reading pane */}
        <div
          className={`flex-1 min-w-0 bg-muted/50 ${
            selectedEmailId ? "flex" : "hidden lg:flex"
          }`}
        >
          {selectedEmailId ? (
            <EmailReader
              emailId={selectedEmailId}
              onBack={() => setSelectedEmailId(null)}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onStarToggle={handleStarToggle}
              onActioned={() => {
                setSelectedEmailId(null);
                setPage(1);
                loadCounts();
              }}
              accountColorById={accountColorById}
              showAccountBar={showAccountBar}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/60">
              <Inbox size={48} className="mb-3 opacity-30" />
              <p className="text-sm">Select an email to read</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode={composeMode}
        jobId={replyTo?.jobId || ""}
        draftId={replyTo?.draftId}
        defaultTo={replyTo?.to || ""}
        defaultCc={replyTo?.cc || ""}
        defaultBcc={replyTo?.bcc || ""}
        defaultSubject={replyTo?.subject || ""}
        defaultBody={replyTo?.body || ""}
        defaultAccountId={replyTo?.accountId}
        replyToMessageId={replyTo?.messageId}
        defaultAttachments={replyTo?.attachments}
        onSent={() => {
          loadEmails();
          loadCounts();
        }}
      />
    </div>
  );
}

function LastSyncedIndicator({
  syncing,
  lastSyncedAt,
  syncFailed,
  onRetry,
  accountsLoaded,
  scopeAccounts,
  selectedAccountId,
}: {
  syncing: boolean;
  lastSyncedAt: Date | null;
  syncFailed: boolean;
  onRetry: () => void;
  accountsLoaded: boolean;
  scopeAccounts: EmailAccount[];
  selectedAccountId: string;
}) {
  // Tick once every 30s so the relative time string ("2 min ago") refreshes
  // without polling anything server-side. The interval count itself is
  // unused — its sole purpose is to trigger a re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!accountsLoaded) return null;

  if (syncing) {
    return (
      <span className="text-xs text-muted-foreground/70">Syncing…</span>
    );
  }

  if (syncFailed) {
    return (
      <button
        onClick={onRetry}
        className="text-xs text-destructive hover:underline"
      >
        Sync failed — retry
      </button>
    );
  }

  // Prefer the hook's lastSyncedAt (most recent in-session sync), fall
  // back to whatever the accounts row reports for the selected scope.
  const fromAccounts = deriveLatestFromAccounts(
    scopeAccounts,
    selectedAccountId,
  );
  const display = lastSyncedAt ?? fromAccounts;
  if (!display) return null;

  return (
    <span className="text-xs text-muted-foreground/70">
      Last synced: {formatRelative(display)}
    </span>
  );
}

function deriveLatestFromAccounts(
  accounts: EmailAccount[],
  selectedAccountId: string,
): Date | null {
  const inScope = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;
  let best: Date | null = null;
  for (const a of inScope) {
    if (!a.last_synced_at) continue;
    const d = new Date(a.last_synced_at);
    if (!best || d > best) best = d;
  }
  return best;
}

function formatRelative(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    document.body.classList.add("select-none");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - lastX;
      lastX = moveEvent.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      document.body.classList.remove("select-none");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 transition-colors"
    />
  );
}

// Email row component
function EmailRow({
  email,
  isSelected,
  isChecked,
  folder,
  accountColor,
  showAccountBar,
  onSelect,
  onStar,
  onToggleCheck,
}: {
  email: Email;
  isSelected: boolean;
  isChecked: boolean;
  folder: string;
  accountColor?: string;
  showAccountBar: boolean;
  onSelect: () => void;
  onStar: () => void;
  onToggleCheck: () => void;
}) {
  // Show recipient for sent/drafts, sender for everything else
  const isSentView = folder === "sent" || folder === "drafts";
  const displayName = isSentView
    ? email.to_addresses?.[0]?.name || email.to_addresses?.[0]?.email || "Unknown"
    : email.from_name || email.from_address;

  return (
    <div
      onClick={onSelect}
      className={`relative flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-border/50 transition-colors ${
        isSelected
          ? "bg-primary/5 border-l-2 border-l-primary"
          : email.is_read
          ? "hover:bg-primary/5"
          : "bg-primary/5 hover:bg-primary/10"
      }`}
    >
      {showAccountBar && accountColor && !isSelected && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ backgroundColor: accountColor }}
          aria-hidden
        />
      )}

      {/* Checkbox + Star (stacked) */}
      <div className="flex flex-col items-center gap-1.5 mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleCheck();
          }}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-border accent-primary"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
        >
          <Star
            size={14}
            className={
              email.is_starred
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            }
          />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${
              email.is_read ? "text-muted-foreground" : "font-semibold text-foreground"
            }`}
          >
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground/60 shrink-0 ml-auto">
            {formatEmailDate(email.received_at)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className={`text-sm truncate ${
              email.is_read ? "text-muted-foreground/60" : "text-foreground"
            }`}
          >
            {email.subject || "(no subject)"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground/40 truncate flex-1">
            {email.snippet}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {email.has_attachments && (
              <Paperclip size={12} className="text-muted-foreground/40" />
            )}
            {email.job && (
              <span className="flex items-center gap-0.5 text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                <Briefcase size={10} />
                {email.job.job_number}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
