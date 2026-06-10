"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Phone as PhoneIcon,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  UserPlus,
  Send,
  Paperclip,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { formatPhoneNumber, normalizePhoneToE164 } from "@/lib/phone";
import { usePhoneSync } from "@/lib/phone/use-phone-sync";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";
import { validateMmsAttachment } from "@/lib/phone/mms-attachments";
import {
  MessageAttachment,
  PhoneAttachmentLightbox,
  type PhoneAttachmentRef,
} from "@/components/phone/message-attachment";
import { mergeThreadItems } from "@/lib/phone/merge-thread-items";

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
  media_urls?: PhoneAttachmentRef[];
}

// Slice 9 (#313) — the voicemail recorded for an unanswered call, flattened
// onto the call by the /calls route. `transcript_status` drives the UI:
// 'pending' (recorded, transcript not back yet), 'ready' (transcript shown),
// 'failed' (transcript unavailable). `audio_storage_path` is the stored MP3
// the <audio> player signs a URL for; it can lag the row briefly while the
// copy-from-Twilio finishes.
interface PhoneVoicemail {
  id: string;
  audio_storage_path: string | null;
  transcript: string | null;
  transcript_status: "pending" | "ready" | "failed";
  duration_seconds: number | null;
}

// Slice 8 (#312) — a voice call in the thread. Threads on the same
// conversation as the messages; `started_at` is its timeline anchor.
// `status`/`duration_seconds` are null until the status-callback webhook
// advances the row (a 'ringing' insert has neither yet).
// Slice 11 (#315) — a call recording attached to an answered call. Like
// voicemail, `audio_storage_path` is the Nookleus-hosted MP3 the player signs a
// URL for; it can lag the row briefly while the copy-from-Twilio finishes.
interface PhoneRecording {
  id: string;
  audio_storage_path: string | null;
  consent_notice_played: boolean;
  duration_seconds: number | null;
}

interface PhoneCall {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  status: string | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  // Slice 9 (#313) — present when the call went to voicemail.
  voicemail?: PhoneVoicemail | null;
  // Slice 11 (#315) — present when the answered call was recorded.
  recording?: PhoneRecording | null;
}

// Slice 6 (#310) — a staged attachment in the compose strip. Either the
// upload is in flight (no storage_path yet) or it has completed and the
// path is the one the outbound /api/phone/messages POST will reference.
interface StagedAttachment {
  id: string;
  filename: string;
  previewUrl: string;
  mediaType: string;
  kind: "image" | "file";
  storage_path?: string;
  uploading: boolean;
  error?: string;
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
  const searchParams = useSearchParams();
  // Slice 12 (#316) — deep link from the Job-page Calls section. `conversation`
  // pre-selects the thread on mount; `call` is the call to scroll into view
  // once that thread's calls load.
  const deepLinkConversation = searchParams?.get("conversation") ?? null;
  const deepLinkCallId = searchParams?.get("call") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(
    deepLinkConversation,
  );
  const [messages, setMessages] = useState<PhoneMessage[]>([]);
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Slice 10 (#314) — outbound bridge call in flight + its error, if any.
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [retagMenuFor, setRetagMenuFor] = useState<string | null>(null);
  // Slice 6 (#310) — staged MMS attachments + the file input ref the
  // paperclip button hands clicks to.
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Slice 6 (#310) — lightbox state: the storage_path of the image
  // currently being shown full-size, or null.
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  // #309 outbound surfaces are gated on the A2P 10DLC feature flag.
  // Computed once at mount — the flag flips by env-var redeploy, not at
  // runtime, so we never need to re-evaluate. The read path (thread,
  // chips, save-as-contact) remains visible either way.
  const outboundEnabled = isPhoneOutboundEnabled();

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

  // Slice 8 (#312) — calls thread alongside the messages; fetched in
  // parallel and interleaved chronologically (mergeThreadItems). A failed
  // calls fetch degrades gracefully — the text thread still renders.
  const loadCalls = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/phone/conversations/${convId}/calls`);
      if (!res.ok) return;
      const data = (await res.json()) as PhoneCall[];
      setCalls(data);
    } catch {
      // Network/parse error — leave calls empty; messages are unaffected.
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDraft("");
    setSendError(null);
    setAttachments([]);
    setAttachError(null);
    setCalls([]);
    void loadMessages(selectedId);
    void loadCalls(selectedId);
  }, [selectedId, loadMessages, loadCalls]);

  // Slice 12 (#316) — after a deep-linked thread's calls load, scroll the call
  // named in `?call=` into view (once). Each CallRow renders a stable
  // `call-row-<id>` anchor; we wait until that call is present before scrolling.
  const didScrollToDeepLinkRef = useRef(false);
  useEffect(() => {
    if (didScrollToDeepLinkRef.current) return;
    if (!deepLinkCallId) return;
    if (!calls.some((c) => c.id === deepLinkCallId)) return;
    const el = document.getElementById(`call-row-${deepLinkCallId}`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      didScrollToDeepLinkRef.current = true;
    }
  }, [calls, deepLinkCallId]);

  const threadItems = useMemo(
    () => mergeThreadItems(messages, calls),
    [messages, calls],
  );

  // Slice 6 (#310) — pre-upload one picked/dropped file. Returns the
  // staged ID so the caller can correlate the in-flight slot.
  const stageOneFile = useCallback(async (file: File) => {
    const validation = validateMmsAttachment({
      type: file.type,
      size: file.size,
    });
    if (!validation.ok) {
      setAttachError(validation.error);
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const previewUrl = URL.createObjectURL(file);
    setAttachError(null);
    setAttachments((prev) => [
      ...prev,
      {
        id,
        filename: file.name,
        previewUrl,
        mediaType: validation.mediaType,
        kind: validation.kind,
        uploading: true,
      },
    ]);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/phone/attachments", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  uploading: false,
                  error: err.error ?? `Upload failed (${res.status})`,
                }
              : a,
          ),
        );
        return;
      }
      const body = (await res.json()) as {
        attachment: {
          storage_path: string;
          media_type: string;
          kind: "image" | "file";
          filename?: string;
        };
      };
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                uploading: false,
                storage_path: body.attachment.storage_path,
                mediaType: body.attachment.media_type,
                kind: body.attachment.kind,
              }
            : a,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, uploading: false, error: message } : a,
        ),
      );
    }
  }, []);

  const onPickFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      for (const file of Array.from(files)) {
        void stageOneFile(file);
      }
    },
    [stageOneFile],
  );

  const onRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

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

  const readyAttachments = useMemo(
    () =>
      attachments.filter(
        (a): a is StagedAttachment & { storage_path: string } =>
          !!a.storage_path && !a.uploading && !a.error,
      ),
    [attachments],
  );
  const anyUploading = attachments.some((a) => a.uploading);

  const onSend = useCallback(async () => {
    if (!selected) return;
    if (anyUploading) return;
    const hasText = draft.trim().length > 0;
    const hasAttachments = readyAttachments.length > 0;
    if (!hasText && !hasAttachments) return;
    setSending(true);
    setSendError(null);
    try {
      const outAttachments = readyAttachments.map((a) => ({
        storage_path: a.storage_path,
        media_type: a.mediaType,
        ...(a.filename ? { filename: a.filename } : {}),
      }));
      const res = await fetch("/api/phone/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: selected.id,
          body: draft,
          sourceContext: { kind: "phone-tab" },
          ...(outAttachments.length > 0
            ? { attachments: outAttachments }
            : {}),
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
          media_urls: outAttachments,
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
      // Drop the strip; the message bubble now shows the media inline.
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }, [selected, draft, readyAttachments, anyUploading, attachments]);

  // Slice 10 (#314) — place an outbound bridge call from the open thread.
  // Twilio rings the Crew Lead's own cell (resolved server-side from their
  // profile) and bridges to the customer with the Nookleus number as caller
  // ID. The route returns the queued phone_calls row; we insert it
  // optimistically as the in-flight indicator, and the status-callback
  // webhook advances it live via the phone_calls realtime UPDATE below.
  //
  // No A2P 10DLC gate — voice has no 10DLC dependency, so Call is available
  // wherever the Phone tab (view_phone) is, regardless of the SMS flag.
  const onCall = useCallback(async () => {
    if (!selected || calling) return;
    setCalling(true);
    setCallError(null);
    try {
      const res = await fetch("/api/phone/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: selected.id,
          sourceContext: { kind: "phone-tab" },
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setCallError(errBody.error ?? `Call failed (${res.status})`);
        return;
      }
      const created = (await res.json()) as {
        id: string;
        conversationId: string;
        twilio_call_sid: string;
        status: string;
      };
      const now = new Date().toISOString();
      // Dedupe: the realtime INSERT echo for this same row may have beaten
      // this optimistic insert (the mirror of onNewCall's own guard). Append
      // only if it isn't already present, or the call shows twice.
      setCalls((prev) =>
        prev.some((c) => c.id === created.id)
          ? prev
          : [
              ...prev,
              {
                id: created.id,
                conversation_id: selected.id,
                direction: "out",
                status: created.status,
                duration_seconds: null,
                started_at: now,
                ended_at: null,
              },
            ],
      );
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === selected.id ? { ...c, last_event_at: now } : c,
          ),
        ),
      );
    } finally {
      setCalling(false);
    }
  }, [selected, calling]);

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
    // Slice 10 (#314) — a call placed elsewhere (or an inbound ring) for the
    // open thread arrives as an INSERT; add it if not already present
    // (our own optimistic insert may have beaten the realtime echo).
    onNewCall: (row) => {
      if (selectedId !== row.conversation_id) return;
      setCalls((prev) =>
        prev.some((c) => c.id === row.id)
          ? prev
          : [
              ...prev,
              {
                id: row.id,
                conversation_id: row.conversation_id,
                direction: row.direction,
                status: row.status,
                duration_seconds: row.duration_seconds,
                started_at: row.started_at,
                ended_at: row.ended_at,
              },
            ],
      );
    },
    // Slice 10 (#314) — the status-callback webhook stamps status /
    // duration / ended_at; patch the in-flight row in place so it advances
    // queued → ringing → in_progress → completed without a refetch.
    onCallUpdate: (row) => {
      setCalls((prev) =>
        prev.map((c) =>
          c.id === row.id
            ? {
                ...c,
                status: row.status,
                duration_seconds: row.duration_seconds,
                ended_at: row.ended_at,
              }
            : c,
        ),
      );
    },
    // Slice 9 (#313) — the transcription-completed webhook UPDATEs the
    // voicemail row after the call already rendered. Patch the matching call
    // in the open thread so "Transcribing…" flips to the transcript (or the
    // failed state) live. A row for a call not in the current thread is a
    // no-op (map finds no match).
    onVoicemailUpdate: (row) => {
      setCalls((prev) =>
        prev.map((c) =>
          c.id === row.phone_call_id
            ? {
                ...c,
                voicemail: {
                  id: row.id,
                  audio_storage_path: row.audio_storage_path,
                  transcript: row.transcript,
                  transcript_status: row.transcript_status,
                  duration_seconds: row.duration_seconds,
                },
              }
            : c,
        ),
      );
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

      {/* Slice 6 (#310) — lightbox over the selected attachment, if any. */}
      {lightboxPath ? (
        <PhoneAttachmentLightbox
          path={lightboxPath}
          onClose={() => setLightboxPath(null)}
        />
      ) : null}

      {/* Right pane — selected thread */}
      <section className="flex-1 flex flex-col">
        {selected ? (
          <>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="font-medium text-foreground">
                {conversationLabel(selected)}
              </div>
              <div className="flex items-center gap-4">
                {/* Slice 10 (#314) — Call. No A2P 10DLC gate (voice has no
                    10DLC dependency); shown wherever the Phone tab is. */}
                <button
                  type="button"
                  onClick={() => void onCall()}
                  disabled={calling}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:underline disabled:opacity-50"
                >
                  <PhoneIcon size={16} /> Call
                </button>
                {selected.contact_id === null ? (
                  <button
                    type="button"
                    onClick={onSaveAsContact}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    <UserPlus size={16} /> Save as Contact
                  </button>
                ) : null}
              </div>
            </header>
            {callError ? (
              <p
                role="alert"
                className="border-b border-border px-4 py-2 text-sm text-red-600 dark:text-red-400"
              >
                {callError}
              </p>
            ) : null}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingThread ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {threadItems.map((item) => {
                if (item.kind === "call") {
                  return (
                    <CallRow key={`call-${item.call.id}`} call={item.call} />
                  );
                }
                const m = item.message;
                const showChips =
                  m.direction === "in" &&
                  m.job_tag === null &&
                  selected.active_jobs.length >= 2;
                const retagOpen = retagMenuFor === m.id;
                return (
                  <div key={`msg-${m.id}`} className="flex flex-col gap-1">
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
                      {/* Slice 6 (#310) — render inline attachments under the body.
                          Images become thumbnails (click → lightbox);
                          non-images become a downloadable filename chip. */}
                      {m.media_urls && m.media_urls.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {m.media_urls.map((mu, idx) => (
                            <li key={`${m.id}-att-${idx}`}>
                              <MessageAttachment
                                attachment={mu}
                                onOpenLightbox={(p) => setLightboxPath(p)}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
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
              <div
                data-dropzone="phone-compose"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onPickFiles(e.dataTransfer?.files ?? null);
                }}
                className="border-t border-border p-3 space-y-2"
              >
                {sendError ? (
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    {sendError}
                  </p>
                ) : null}
                {attachError ? (
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    {attachError}
                  </p>
                ) : null}
                {selected.active_jobs.length > 0 && selected.contact_id ? (
                  <p className="text-xs text-muted-foreground">
                    This message will be smart-attached when sent.
                  </p>
                ) : null}
                {attachments.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {attachments.map((a) => (
                      <li
                        key={a.id}
                        className="relative inline-flex items-center rounded-md border border-border bg-background p-1 text-xs"
                      >
                        {a.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.previewUrl}
                            alt={a.filename}
                            className="h-14 w-14 rounded object-cover"
                          />
                        ) : (
                          <span className="block max-w-[12rem] truncate px-2">
                            {a.filename}
                          </span>
                        )}
                        {a.uploading ? (
                          <span className="ml-2 text-muted-foreground">
                            Uploading…
                          </span>
                        ) : null}
                        {a.error ? (
                          <span className="ml-2 text-red-600">{a.error}</span>
                        ) : null}
                        <button
                          type="button"
                          aria-label="Remove attachment"
                          onClick={() => onRemoveAttachment(a.id)}
                          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background shadow"
                        >
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onPickFiles(e.target.files);
                      // Reset so re-picking the same file fires onChange.
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Attach"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
                  >
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Text message"
                    rows={2}
                    className="flex-1 resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40"
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" && (e.metaKey || e.ctrlKey)) &&
                        (draft.trim().length > 0 ||
                          readyAttachments.length > 0) &&
                        !sending &&
                        !anyUploading
                      ) {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void onSend()}
                    disabled={
                      sending ||
                      anyUploading ||
                      (draft.trim().length === 0 &&
                        readyAttachments.length === 0)
                    }
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

// Slice 8 (#312) — render a Twilio status code as human-readable text.
// "no_answer" → "No answer", "in_progress" → "In progress", etc.
function formatCallStatus(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Slice 8 (#312) — seconds → mm:ss (e.g. 125 → "2:05").
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Slice 8 (#312) — a voice call rendered inline in the thread, centered
// like a system row (distinct from the left/right message bubbles). Slice 9
// (#313) — when the call went to voicemail, its recording + transcript render
// inline beneath the call pill.
function CallRow({ call }: { call: PhoneCall }) {
  const incoming = call.direction === "in";
  const label = incoming ? "Incoming call" : "Outgoing call";
  const DirectionIcon = incoming ? PhoneIncoming : PhoneOutgoing;
  return (
    <div id={`call-row-${call.id}`} className="flex flex-col items-center gap-1">
      {/* A call renders as a centered status pill. Slice 11 (#315) replaced the
          tap-to-open placeholder with inline recording playback below the pill,
          so the pill is no longer interactive. */}
      <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <DirectionIcon size={12} aria-hidden="true" />
        <span>{label}</span>
        {call.status && <span>{formatCallStatus(call.status)}</span>}
        {call.duration_seconds !== null && (
          <span>{formatDuration(call.duration_seconds)}</span>
        )}
        <span>
          {new Date(call.started_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
      {call.voicemail ? <VoicemailBlock voicemail={call.voicemail} /> : null}
      {call.recording ? <RecordingBlock recording={call.recording} /> : null}
    </div>
  );
}

// Slice 9 (#313) — the voicemail recording + transcript shown under a call.
// The transcript renders synchronously from the call payload; the audio
// player fetches a short-lived signed URL for the stored MP3 (mirrors
// MessageAttachment). Pending/failed transcript states land in slice 8.
function VoicemailBlock({ voicemail }: { voicemail: PhoneVoicemail }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-background p-2 text-xs">
      {voicemail.audio_storage_path ? (
        <VoicemailPlayer storagePath={voicemail.audio_storage_path} />
      ) : null}
      {voicemail.transcript_status === "ready" && voicemail.transcript ? (
        <p className="mt-1 text-foreground">{voicemail.transcript}</p>
      ) : null}
      {voicemail.transcript_status === "pending" ? (
        <p className="mt-1 italic text-muted-foreground">Transcribing…</p>
      ) : null}
      {voicemail.transcript_status === "failed" ? (
        <p className="mt-1 italic text-muted-foreground">
          Transcript unavailable
        </p>
      ) : null}
    </div>
  );
}

// Slice 9 (#313) — <audio> player for a stored voicemail. Fetches a signed URL
// for the MP3 on mount (same signed-URL pattern as MessageAttachment) and
// renders a native audio control once it resolves.
function VoicemailPlayer({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/phone/recordings?path=${encodeURIComponent(storagePath)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      if (!cancelled) setUrl(body.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath]);
  return (
    <audio
      controls
      src={url ?? undefined}
      aria-label="Voicemail recording"
      className="w-full"
    />
  );
}

// Slice 11 (#315) — the call recording shown under an answered call. Mirrors
// VoicemailBlock: the player renders once the audio copy has landed
// (audio_storage_path set); until then the row simply shows no player (the
// recording-completed webhook fills the path moments after the call ends).
function RecordingBlock({ recording }: { recording: PhoneRecording }) {
  if (!recording.audio_storage_path) return null;
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-background p-2 text-xs">
      <RecordingPlayer storagePath={recording.audio_storage_path} />
    </div>
  );
}

// Slice 11 (#315) — <audio> player for a stored call recording. Identical to
// VoicemailPlayer (recordings share the phone-recordings bucket and the same
// signed-URL route); only the aria-label differs.
function RecordingPlayer({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/phone/recordings?path=${encodeURIComponent(storagePath)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      if (!cancelled) setUrl(body.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath]);
  return (
    <audio
      controls
      src={url ?? undefined}
      aria-label="Call recording"
      className="w-full"
    />
  );
}
