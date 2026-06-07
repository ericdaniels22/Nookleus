"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase";
import { findContactByPhone, formatPhoneNumber } from "@/lib/phone";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";
import { usePhoneSync } from "@/lib/phone/use-phone-sync";
import { JobMessageRow } from "@/components/phone/job-message-row";
import { ComposeTextModal } from "@/components/phone/compose-text-modal";
import type { PhoneAttachmentRef } from "@/components/phone/message-attachment";

// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Messages (N) section.
//
// Mirrors the Emails (N) section on every Job page. Renders every text/MMS
// tagged to this Job — across all numbers (Shared and Personal) and all
// teammates who corresponded about it. The list is read through
// GET /api/phone/messages?jobId= (RLS enforces per-message visibility);
// the whole section is hidden from anyone without `view_phone`.

export interface JobMessageContact {
  id: string;
  name: string;
  phone: string | null;
}

export interface JobMessage {
  id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  body: string | null;
  media_urls: PhoneAttachmentRef[];
  sent_at: string;
  job_tag: string | null;
}

export function JobMessagesSection({
  jobId,
  organizationId,
  contacts,
}: {
  jobId: string;
  organizationId: string | null;
  contacts: JobMessageContact[];
}) {
  const { hasPermission, loading } = useAuth();
  const canView = !loading && hasPermission("view_phone");
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);

  // Only contacts with a phone number can be texted; the Text button is
  // hidden when there's no one to text or while outbound SMS is gated
  // (#305 A2P 10DLC).
  const textableContacts = contacts.filter((c) => c.phone);
  const canText = isPhoneOutboundEnabled() && textableContacts.length > 0;

  const fetchMessages = useCallback(async () => {
    const res = await fetch(
      `/api/phone/messages?jobId=${encodeURIComponent(jobId)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as JobMessage[];
    setMessages(Array.isArray(data) ? data : []);
  }, [jobId]);

  useEffect(() => {
    if (!canView) return;
    void fetchMessages();
  }, [canView, fetchMessages]);

  // Realtime: re-pull this Job's tagged messages whenever a phone_message in
  // the org is inserted (a new Job-tagged text arrives) or updated (an
  // existing message is re-tagged to a Job). The refetch re-applies the
  // job_tag filter server-side, so the org-wide subscription stays a coarse
  // "something changed → reload" signal — the simplest correct thing, like
  // the Phone tab (slice 4). Non-view_phone users hold no subscription.
  const supabase = useMemo(() => createClient(), []);
  usePhoneSync({
    supabase,
    organizationId: canView ? organizationId : null,
    onNewMessage: () => void fetchMessages(),
    onMessageUpdate: () => void fetchMessages(),
  });

  if (!canView) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          <MessageSquare size={16} className="inline mr-2 -mt-0.5" />
          Messages ({messages.length})
        </h3>
        {canText && (
          <button
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-colors gap-1.5"
          >
            <Send size={14} />
            Text
          </button>
        )}
      </div>
      <ComposeTextModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        jobId={jobId}
        contacts={textableContacts}
        onSent={fetchMessages}
      />
      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((m) => {
            const number = m.direction === "in" ? m.from_e164 : m.to_e164;
            const contact = findContactByPhone(contacts, number);
            return (
              <JobMessageRow
                key={m.id}
                message={{
                  id: m.id,
                  direction: m.direction,
                  from_e164: m.from_e164,
                  to_e164: m.to_e164,
                  body: m.body,
                  media_urls: m.media_urls ?? [],
                  sent_at: m.sent_at,
                  counterpartyLabel: contact
                    ? contact.name
                    : formatPhoneNumber(number),
                }}
              />
            );
          })}
        </div>
      )}
      {messages.length === 0 && (
        <div className="text-center py-6">
          <MessageSquare
            size={32}
            className="mx-auto text-muted-foreground/40 mb-2"
          />
          <p className="text-sm text-muted-foreground/60">
            No text messages linked to this job yet.
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            Text a contact using the button above.
          </p>
        </div>
      )}
    </div>
  );
}
