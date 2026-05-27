"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone as PhoneIcon, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { formatPhoneNumber } from "@/lib/phone";
import { usePhoneSync } from "@/lib/phone/use-phone-sync";

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
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

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

  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center max-w-md">
          <PhoneIcon size={40} className="mx-auto text-muted-foreground mb-4" />
          <h1 className="text-lg font-semibold text-foreground">Phone</h1>
          <p className="text-sm text-muted-foreground mt-2">
            No conversations yet — text or call a Contact to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left pane — Conversations list */}
      <aside className="w-80 border-r border-border overflow-y-auto">
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
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === "in"
                          ? "self-start bg-muted"
                          : "self-end bg-[var(--brand-primary)] text-white"
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                );
              })}
            </div>
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
