"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone as PhoneIcon, Plus, UserPlus, Send } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { formatPhoneNumber, normalizePhoneToE164 } from "@/lib/phone";
import { usePhoneSync } from "@/lib/phone/use-phone-sync";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — two-pane Phone-tab UI.
//
// Left pane: Conversations list, sorted by `last_event_at` desc with
// unread on top. Right pane: the selected thread, messages
// chronologically. Empty state when no conversations.
//
// AC bullets satisfied here:
//   - Phone-tab list renders sorted by last_event_at desc, unread on top.
//   - Thread renders chronologically.
//   - Save as Contact button on the header when `contact_id` is NULL.
//   - Tag-chips banner above untagged inbound messages when the contact
//     has 2+ Active jobs (the `smartAttach.kind = 'prompt'` state).
//   - Realtime via use-phone-sync subscribed to phone_messages INSERTs.

export interface PhoneConversationItem {
  id: string;
  organization_id: string;
  phone_number_id: string;
  outside_e164: string;
  contact_id: string | null;
  // Server-side joined name when contact_id is set; null until "Save as Contact".
  contact_name: string | null;
  last_event_at: string;
  unread_count: number;
  active_jobs: Array<{ id: string; label: string }>;
}

interface PhoneMessage {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
  job_tag: string | null;
}

export interface PhonePageClientProps {
  organizationId: string;
  initialConversations: PhoneConversationItem[];
}

function sortConversations(
  list: PhoneConversationItem[],
): PhoneConversationItem[] {
  // Unread on top, then by last_event_at desc. Stable.
  return [...list].sort((a, b) => {
    const aUnread = a.unread_count > 0 ? 1 : 0;
    const bUnread = b.unread_count > 0 ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return (
      new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime()
    );
  });
}

function conversationLabel(c: PhoneConversationItem): string {
  return c.contact_name ?? formatPhoneNumber(c.outside_e164);
}

export function PhonePageClient({
  organizationId,
  initialConversations,
}: PhonePageClientProps) {
  const [conversations, setConversations] = useState(
    sortConversations(initialConversations),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PhoneMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retagMenuFor, setRetagMenuFor] = useState<string | null>(null);
  // #309 outbound surfaces are gated on the A2P 10DLC feature flag.
  // Computed once at mount — the flag flips by env-var redeploy, not at
  // runtime, so we never need to re-evaluate. The read path (thread,
  // chips, save-as-contact) remains visible either way.
  const outboundEnabled = isPhoneOutboundEnabled();

  const searchParams = useSearchParams();
  const initialTo = searchParams?.get("to") ?? null;
  const [newConv, setNewConv] = useState<null | { to: string; body: string }>(
    outboundEnabled && initialTo ? { to: initialTo, body: "" } : null,
  );
  const [newConvError, setNewConvError] = useState<string | null>(null);
  const [creatingConv, setCreatingConv] = useState(false);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingThread(true);
    try {
      const res = await fetch(`/api/phone/conversations/${convId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as PhoneMessage[];
      setMessages(data);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDraft("");
    setSendError(null);
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  const onCreateConversation = useCallback(async () => {
    if (!newConv) return;
    const normalized = normalizePhoneToE164(newConv.to);
    if (!normalized) {
      setNewConvError("Enter a valid phone number");
      return;
    }
    if (newConv.body.trim().length === 0) {
      setNewConvError("Enter a message");
      return;
    }
    setCreatingConv(true);
    setNewConvError(null);
    try {
      const res = await fetch("/api/phone/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outsideE164: normalized,
          body: newConv.body,
          sourceContext: { kind: "phone-tab" },
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setNewConvError(errBody.error ?? `Send failed (${res.status})`);
        return;
      }
      const created = (await res.json()) as { conversationId: string };
      // Optimistically prepend the new conversation; loading the messages
      // happens via the existing selectedId effect.
      setConversations((prev) =>
        sortConversations([
          {
            id: created.conversationId,
            organization_id: organizationId,
            phone_number_id: "",
            outside_e164: normalized,
            contact_id: null,
            contact_name: null,
            last_event_at: new Date().toISOString(),
            unread_count: 0,
            active_jobs: [],
          },
          ...prev.filter((c) => c.id !== created.conversationId),
        ]),
      );
      setSelectedId(created.conversationId);
      setNewConv(null);
    } finally {
      setCreatingConv(false);
    }
  }, [newConv, organizationId]);

  const onSend = useCallback(async () => {
    if (!selected || draft.trim().length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/phone/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: selected.id,
          body: draft,
          sourceContext: { kind: "phone-tab" },
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setSendError(errBody.error ?? `Send failed (${res.status})`);
        return;
      }
      const created = (await res.json()) as {
        id: string;
        twilio_sid: string;
        status: string;
      };
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: created.id,
          conversation_id: selected.id,
          direction: "out",
          body: draft,
          sent_at: now,
          job_tag: null,
        },
      ]);
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === selected.id ? { ...c, last_event_at: now } : c,
          ),
        ),
      );
      setDraft("");
    } finally {
      setSending(false);
    }
  }, [selected, draft]);

  // Realtime: when a new inbound lands, reload the affected thread and
  // bump the conversation in the list. Slice 4's update is intentionally
  // coarse — a full thread re-fetch on each incoming message — because
  // it is the simplest correct thing. Later slices can optimize.
  const supabase = useMemo(() => createClient(), []);
  usePhoneSync({
    supabase,
    organizationId,
    onNewMessage: (row) => {
      if (selectedId === row.conversation_id) {
        void loadMessages(row.conversation_id);
      }
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === row.conversation_id
            ? {
                ...c,
                last_event_at: row.sent_at,
                unread_count:
                  selectedId === row.conversation_id
                    ? c.unread_count
                    : c.unread_count + 1,
              }
            : c,
        );
        return sortConversations(next);
      });
    },
  });

  const onSaveAsContact = useCallback(async () => {
    if (!selected || selected.contact_id) return;
    const fullName = window.prompt("Name for new Contact?");
    if (!fullName) return;
    const res = await fetch(
      `/api/phone/conversations/${selected.id}/save-as-contact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName }),
      },
    );
    if (!res.ok) return;
    const { contact } = (await res.json()) as {
      contact: { id: string; full_name: string };
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? { ...c, contact_id: contact.id, contact_name: contact.full_name }
          : c,
      ),
    );
  }, [selected]);

  const onTagJob = useCallback(
    async (messageId: string, jobId: string) => {
      const res = await fetch(`/api/phone/messages/${messageId}/tag`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, job_tag: jobId } : m)),
      );
    },
    [],
  );

  const newConvForm = newConv ? (
    <div className="border-b border-border p-3 space-y-2 bg-muted/30">
      <h2 className="text-sm font-semibold text-foreground">New conversation</h2>
      {newConvError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {newConvError}
        </p>
      ) : null}
      <label className="block text-xs text-muted-foreground">
        To
        <input
          type="tel"
          value={newConv.to}
          onChange={(e) =>
            setNewConv((prev) => (prev ? { ...prev, to: e.target.value } : prev))
          }
          placeholder="+15551234567"
          className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Message
        <textarea
          value={newConv.body}
          onChange={(e) =>
            setNewConv((prev) =>
              prev ? { ...prev, body: e.target.value } : prev,
            )
          }
          rows={2}
          className="mt-1 block w-full resize-none rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setNewConv(null)}
          className="text-sm text-muted-foreground hover:underline"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onCreateConversation()}
          disabled={creatingConv}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  ) : null;

  if (conversations.length === 0 && !newConv) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center max-w-md">
          <PhoneIcon size={40} className="mx-auto text-muted-foreground mb-4" />
          <h1 className="text-lg font-semibold text-foreground">Phone</h1>
          <p className="text-sm text-muted-foreground mt-2">
            No conversations yet — text or call a Contact to get started.
          </p>
          {outboundEnabled ? (
            <button
              type="button"
              onClick={() => setNewConv({ to: "", body: "" })}
              className="mt-4 inline-flex items-center gap-1 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-medium text-white"
            >
              <Plus size={14} /> New conversation
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left pane — Conversations list */}
      <aside className="w-80 border-r border-border overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Conversations</span>
          {outboundEnabled ? (
            <button
              type="button"
              onClick={() => setNewConv({ to: "", body: "" })}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-primary)] px-2 py-1 text-xs font-medium text-white"
            >
              <Plus size={12} /> New conversation
            </button>
          ) : null}
        </div>
        {outboundEnabled ? newConvForm : null}
        <ul role="list">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent ${
                  selectedId === c.id ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {conversationLabel(c)}
                  </span>
                  {c.unread_count > 0 ? (
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--brand-primary)] text-white text-xs px-2 min-w-[20px]">
                      {c.unread_count}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Right pane — selected thread */}
      <section className="flex-1 flex flex-col">
        {selected ? (
          <>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="font-medium text-foreground">
                {conversationLabel(selected)}
              </div>
              {selected.contact_id === null ? (
                <button
                  type="button"
                  onClick={onSaveAsContact}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:underline"
                >
                  <UserPlus size={16} /> Save as Contact
                </button>
              ) : null}
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingThread ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {messages.map((m) => {
                const showChips =
                  m.direction === "in" &&
                  m.job_tag === null &&
                  selected.active_jobs.length >= 2;
                const retagOpen = retagMenuFor === m.id;
                return (
                  <div key={m.id} className="flex flex-col gap-1">
                    {showChips ? (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-muted-foreground self-center">
                          Tag to:
                        </span>
                        {selected.active_jobs.map((j) => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => onTagJob(m.id, j.id)}
                            className="rounded-full bg-accent px-3 py-1 hover:bg-accent/70"
                          >
                            {j.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div
                      className={`group relative max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === "in"
                          ? "self-start bg-muted"
                          : "self-end bg-[var(--brand-primary)] text-white"
                      }`}
                    >
                      {m.body}
                      {/* Re-tag affordance — small button on every message. */}
                      <button
                        type="button"
                        aria-label="Re-tag"
                        onClick={() =>
                          setRetagMenuFor(retagOpen ? null : m.id)
                        }
                        className="absolute -top-2 -right-2 hidden h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] font-medium text-foreground shadow group-hover:flex"
                      >
                        ⋯
                      </button>
                    </div>
                    {retagOpen ? (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-muted-foreground self-center">
                          Re-tag to:
                        </span>
                        {selected.active_jobs.map((j) => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => {
                              setRetagMenuFor(null);
                              void onTagJob(m.id, j.id);
                            }}
                            className="rounded-full bg-accent px-3 py-1 hover:bg-accent/70"
                          >
                            {j.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={async () => {
                            setRetagMenuFor(null);
                            await fetch(`/api/phone/messages/${m.id}/tag`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ jobId: null }),
                            });
                            setMessages((prev) =>
                              prev.map((x) =>
                                x.id === m.id ? { ...x, job_tag: null } : x,
                              ),
                            );
                          }}
                          className="rounded-full border border-border px-3 py-1 hover:bg-accent/40"
                        >
                          Remove tag
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {/* Compose box — PRD #304 § Compose box UI (slice 5 / #309).
                Gated on #305 (A2P 10DLC). When the flag is off, render a
                small banner explaining the wait so users aren't left
                wondering why they can't reply. */}
            {outboundEnabled ? (
              <div className="border-t border-border p-3 space-y-2">
                {sendError ? (
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    {sendError}
                  </p>
                ) : null}
                {selected.active_jobs.length > 0 && selected.contact_id ? (
                  <p className="text-xs text-muted-foreground">
                    This message will be smart-attached when sent.
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Text message"
                    rows={2}
                    className="flex-1 resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40"
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" && (e.metaKey || e.ctrlKey)) &&
                        draft.trim().length > 0 &&
                        !sending
                      ) {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void onSend()}
                    disabled={sending || draft.trim().length === 0}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <Send size={14} /> Send
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border p-3 text-xs text-muted-foreground">
                Sending texts is pending A2P 10DLC carrier registration.
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a conversation
          </div>
        )}
      </section>
    </div>
  );
}
