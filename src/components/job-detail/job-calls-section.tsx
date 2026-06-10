"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase";
import { findContactByPhone, formatPhoneNumber } from "@/lib/phone";
import { usePhoneSync } from "@/lib/phone/use-phone-sync";
import {
  JobCallRow,
  type JobCallVoicemail,
  type JobCallRecording,
} from "@/components/phone/job-call-row";
import type { JobMessageContact } from "./job-messages-section";

// PRD #304 — Nookleus Phone. Slice 12 (#316) — Job-page Calls (N) section.
//
// Mirrors the Messages (N) / Emails (N) sections on every Job page. Renders
// every voice call tagged to this Job — across all numbers (Shared and
// Personal) and all teammates — read through GET /api/phone/calls?jobId=
// (RLS enforces per-call visibility). The whole section is hidden from anyone
// without `view_phone`. Read-only: placing a call is the Messages section's
// Call button (slice 10); this section is the history.

export interface JobCall {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  status: string | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  job_tag: string | null;
  voicemail?: JobCallVoicemail | null;
  recording?: JobCallRecording | null;
}

export function JobCallsSection({
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
  const [calls, setCalls] = useState<JobCall[]>([]);

  const fetchCalls = useCallback(async () => {
    const res = await fetch(
      `/api/phone/calls?jobId=${encodeURIComponent(jobId)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as JobCall[];
    setCalls(Array.isArray(data) ? data : []);
  }, [jobId]);

  useEffect(() => {
    if (!canView) return;
    void fetchCalls();
  }, [canView, fetchCalls]);

  const supabase = useMemo(() => createClient(), []);
  usePhoneSync({
    supabase,
    organizationId: canView ? organizationId : null,
    onNewMessage: () => {},
    onNewCall: () => void fetchCalls(),
    onCallUpdate: () => void fetchCalls(),
    onVoicemailUpdate: () => void fetchCalls(),
  });

  if (!canView) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          <Phone size={16} className="inline mr-2 -mt-0.5" />
          Calls ({calls.length})
        </h3>
      </div>
      {calls.length > 0 && (
        <div className="space-y-3">
          {calls.map((c) => {
            const number = c.direction === "in" ? c.from_e164 : c.to_e164;
            const contact = findContactByPhone(contacts, number);
            return (
              <JobCallRow
                key={c.id}
                call={{
                  id: c.id,
                  conversationId: c.conversation_id,
                  direction: c.direction,
                  status: c.status,
                  duration_seconds: c.duration_seconds,
                  started_at: c.started_at,
                  counterpartyLabel: contact
                    ? contact.name
                    : formatPhoneNumber(number),
                  voicemail: c.voicemail,
                  recording: c.recording,
                }}
              />
            );
          })}
        </div>
      )}
      {calls.length === 0 && (
        <div className="text-center py-6">
          <Phone size={32} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground/60">
            No phone calls linked to this job yet.
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            Call a contact using the button on the Messages section.
          </p>
        </div>
      )}
    </div>
  );
}
