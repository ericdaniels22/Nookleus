"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Reply,
  ReplyAll,
  Forward,
  Star,
  Paperclip,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Download,
  FileIcon,
  Trash2,
  ShieldAlert,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type { Email } from "@/lib/types";

function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const baseStyles = `
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; background: #fff; color: #333;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px; line-height: 1.5; word-wrap: break-word; }
      img { max-width: 100%; height: auto; }
      a { color: #2B5EA7; }
      table { max-width: 100%; }
    `;

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${baseStyles}</style></head><body>${html}</body></html>`);
    doc.close();

    const resize = () => {
      if (!doc.body) return;
      setHeight(doc.body.scrollHeight + 16);
    };
    resize();
    const obs = new ResizeObserver(resize);
    if (doc.body) obs.observe(doc.body);
    return () => obs.disconnect();
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Email body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}

interface EmailReaderProps {
  emailId: string;
  onBack: () => void;
  onReply: (email: Email) => void;
  onReplyAll: (email: Email) => void;
  onForward: (email: Email) => void;
  onStarToggle: (id: string, starred: boolean) => void;
  onActioned?: () => void;
  accountColorById?: Map<string, string>;
  showAccountBar?: boolean;
}

interface JobOption {
  id: string;
  job_number: string;
  property_address: string;
}

export default function EmailReader({
  emailId,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onStarToggle,
  onActioned,
  accountColorById,
  showAccountBar,
}: EmailReaderProps) {
  const [thread, setThread] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<JobOption[]>([]);
  const jobPickerRef = useRef<HTMLDivElement>(null);
  // Per-email-id, so we only refetch each email's attachments once even
  // when the user opens it within the first ~3 seconds of a sync.
  const hasPolledAttachmentsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  async function loadThread() {
    setLoading(true);
    try {
      // First get the email to find its thread_id
      const emailRes = await fetch(`/api/email/${emailId}`);
      const email = await emailRes.json();

      if (email.thread_id) {
        const threadRes = await fetch(
          `/api/email/thread/${encodeURIComponent(email.thread_id)}`
        );
        const threadEmails = await threadRes.json();
        if (Array.isArray(threadEmails) && threadEmails.length > 1) {
          setThread(threadEmails);
          // Expand the last email by default
          setExpandedIds(new Set([threadEmails[threadEmails.length - 1].id]));
        } else {
          setThread([email]);
          setExpandedIds(new Set([email.id]));
        }
      } else {
        setThread([email]);
        setExpandedIds(new Set([email.id]));
      }

      // Mark as read
      if (!email.is_read) {
        await fetch(`/api/email/${emailId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_read: true }),
        });
      }
    } catch {
      // fallback
    }
    setLoading(false);
  }

  async function runAction(action: string, jobId?: string) {
    setActionLoading(true);
    try {
      const res = await fetch("/api/email/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [emailId], action, jobId }),
      });
      if (!res.ok) throw new Error("Action failed");
      if (action === "trash") toast.success("Moved to trash");
      else if (action === "spam") toast.success("Marked as spam");
      else if (action === "assign_job") toast.success("Assigned to job");
      onActioned?.();
    } catch {
      toast.error("Action failed");
    }
    setActionLoading(false);
    setJobPickerOpen(false);
  }

  // Debounced job search
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

  // One-shot poll for attachments. When an email has `has_attachments=true`
  // but no rows in `email_attachments` yet, the after() upload is mid-flight.
  // Refetch once at 1.5s — usually long enough to catch the upload.
  useEffect(() => {
    const needsPoll = thread.filter((e) => {
      if (!expandedIds.has(e.id)) return false;
      if (!e.has_attachments) return false;
      if (e.attachments && e.attachments.length > 0) return false;
      if (hasPolledAttachmentsRef.current.has(e.id)) return false;
      return true;
    });
    if (needsPoll.length === 0) return;
    for (const e of needsPoll) hasPolledAttachmentsRef.current.add(e.id);
    const t = setTimeout(() => loadThread(), 1500);
    return () => clearTimeout(t);
    // loadThread is stable-ish (closure over emailId only, set on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, expandedIds]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999]">
        Loading...
      </div>
    );
  }

  if (thread.length === 0) return null;

  const latestEmail = thread[thread.length - 1];
  const accountColor = accountColorById?.get(latestEmail.account_id);

  return (
    <div className="flex flex-col h-full min-w-0">
      {showAccountBar && accountColor && (
        <div
          className="w-full h-[3px] shrink-0"
          style={{ backgroundColor: accountColor }}
          aria-hidden
        />
      )}
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <button
          onClick={onBack}
          className="lg:hidden p-1 text-muted-foreground hover:text-foreground rounded"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-foreground truncate flex-1 min-w-0">
          {latestEmail.subject || "(no subject)"}
        </h2>
        {thread.length > 1 && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {thread.length} messages
          </span>
        )}
        <button
          onClick={() => onStarToggle(latestEmail.id, !latestEmail.is_starred)}
          className="p-1 hover:bg-accent rounded"
        >
          <Star
            size={16}
            className={
              latestEmail.is_starred
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/60"
            }
          />
        </button>
        <div className="relative" ref={jobPickerRef}>
          <button
            onClick={() => setJobPickerOpen((v) => !v)}
            disabled={actionLoading}
            title={latestEmail.job ? `Job ${latestEmail.job.job_number}` : "Assign to job"}
            className={`p-1.5 rounded hover:bg-accent disabled:opacity-50 ${
              latestEmail.job ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Briefcase size={16} />
          </button>
          {jobPickerOpen && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-popover border border-border rounded-lg shadow-lg z-20 p-2">
              <div className="relative mb-2">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search jobs…"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 text-sm border border-border rounded bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {latestEmail.job && (
                <button
                  onClick={() => runAction("assign_job", "")}
                  className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded mb-1"
                >
                  Unassign from job {latestEmail.job.job_number}
                </button>
              )}
              <div className="max-h-60 overflow-y-auto">
                {jobResults.length === 0 && jobSearch.length > 0 && (
                  <p className="text-xs text-muted-foreground/60 px-2 py-2">No matches</p>
                )}
                {jobResults.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => runAction("assign_job", job.id)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded"
                  >
                    <div className="font-medium text-foreground">{job.job_number}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {job.property_address}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => runAction("trash")}
          disabled={actionLoading}
          title="Delete"
          className="p-1.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-50"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={() => runAction("spam")}
          disabled={actionLoading}
          title="Mark as spam"
          className="p-1.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-50"
        >
          <ShieldAlert size={16} />
        </button>
        <button
          onClick={() => onReply(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent"
          title="Reply"
        >
          <Reply size={14} />
        </button>
        <button
          onClick={() => onReplyAll(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent"
          title="Reply All"
        >
          <ReplyAll size={14} />
        </button>
        <button
          onClick={() => onForward(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent"
          title="Forward"
        >
          <Forward size={14} />
        </button>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {thread.map((email) => {
          const isExpanded = expandedIds.has(email.id);
          return (
            <div
              key={email.id}
              className="border border-gray-200 rounded-lg overflow-hidden bg-white"
            >
              {/* Collapsed header — always shown */}
              <button
                onClick={() => toggleExpand(email.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <div className="w-8 h-8 rounded-full bg-[#2B5EA7] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {(email.from_name || email.from_address)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#333] truncate">
                      {email.from_name || email.from_address}
                    </span>
                    <span className="text-xs text-[#999]">
                      {format(new Date(email.received_at), "MMM d, yyyy h:mm a")}
                    </span>
                  </div>
                  {!isExpanded && (
                    <p className="text-xs text-[#999] truncate mt-0.5">
                      {email.snippet}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {email.has_attachments && (
                    <Paperclip size={14} className="text-[#999]" />
                  )}
                  {email.job && (
                    <span className="flex items-center gap-1 text-xs bg-blue-50 text-[#2B5EA7] px-2 py-0.5 rounded-full">
                      <Briefcase size={10} />
                      {email.job.job_number}
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp size={14} className="text-[#999]" />
                  ) : (
                    <ChevronDown size={14} className="text-[#999]" />
                  )}
                </div>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  {/* To/CC details */}
                  <div className="px-4 py-2 text-xs text-[#999] bg-gray-50/50 space-y-0.5">
                    <div>
                      <span className="font-medium text-[#666]">From:</span>{" "}
                      {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}
                    </div>
                    <div>
                      <span className="font-medium text-[#666]">To:</span>{" "}
                      {email.to_addresses
                        ?.map(
                          (a: { email: string; name?: string }) =>
                            a.name ? `${a.name} <${a.email}>` : a.email
                        )
                        .join(", ")}
                    </div>
                    {email.cc_addresses && email.cc_addresses.length > 0 && (
                      <div>
                        <span className="font-medium text-[#666]">CC:</span>{" "}
                        {email.cc_addresses
                          .map(
                            (a: { email: string; name?: string }) =>
                              a.name ? `${a.name} <${a.email}>` : a.email
                          )
                          .join(", ")}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="px-4 py-4">
                    {email.body_html ? (
                      <EmailBodyFrame html={email.body_html} />
                    ) : (
                      <pre className="text-sm text-[#333] whitespace-pre-wrap font-sans leading-relaxed">
                        {email.body_text || "(empty)"}
                      </pre>
                    )}
                  </div>

                  {/* Attachments — list when uploaded, "Downloading…" placeholder
                       briefly while after() finishes the post-response upload. */}
                  {email.has_attachments && (
                    <div className="px-4 py-3 border-t border-gray-100">
                      {email.attachments && email.attachments.length > 0 ? (
                        <>
                          <p className="text-xs font-medium text-[#666] mb-2 flex items-center gap-1">
                            <Paperclip size={12} />
                            {email.attachments.length} attachment{email.attachments.length !== 1 ? "s" : ""}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {email.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={`/api/email/attachments/${att.id}`}
                                download={att.filename}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors group"
                              >
                                <FileIcon size={16} className="text-[#2B5EA7] shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm text-[#333] truncate max-w-[200px]">
                                    {att.filename}
                                  </p>
                                  {att.file_size && (
                                    <p className="text-[10px] text-[#999]">
                                      {att.file_size > 1024 * 1024
                                        ? `${(att.file_size / (1024 * 1024)).toFixed(1)}MB`
                                        : `${(att.file_size / 1024).toFixed(0)}KB`}
                                    </p>
                                  )}
                                </div>
                                <Download size={14} className="text-[#999] group-hover:text-[#2B5EA7] shrink-0" />
                              </a>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-[#999] flex items-center gap-2">
                          <Paperclip size={12} />
                          Downloading…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
