"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";

// PRD #304 — Nookleus Phone. Slice 12 (#316) — Job-page call row.
//
// One voice call in the Job-page Calls section. Parallels JobMessageRow: a
// per-row context header (counterparty + when) because the section spans many
// conversations and numbers, then a compact meta line (direction, outcome,
// talk time) and — when present — inline players for the call recording and/or
// voicemail. The players fetch a short-lived signed URL for the stored MP3,
// mirroring the Phone-tab thread's RecordingPlayer/VoicemailPlayer (a parallel
// small player, so the Phone-tab component is untouched).

export interface JobCallVoicemail {
  id: string;
  audio_storage_path: string | null;
  transcript: string | null;
  transcript_status: "pending" | "ready" | "failed";
  duration_seconds: number | null;
}

export interface JobCallRecording {
  id: string;
  audio_storage_path: string | null;
  consent_notice_played: boolean;
  duration_seconds: number | null;
}

export interface JobCallRowData {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  status: string | null;
  duration_seconds: number | null;
  started_at: string;
  counterpartyLabel: string;
  voicemail?: JobCallVoicemail | null;
  recording?: JobCallRecording | null;
}

// Title-case a status token: "no_answer" → "No answer".
function formatCallStatus(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// seconds → mm:ss (e.g. 125 → "2:05").
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function JobCallRow({ call }: { call: JobCallRowData }) {
  const incoming = call.direction === "in";
  const DirectionIcon = incoming ? PhoneIncoming : PhoneOutgoing;
  // Answered calls carry talk time; an unanswered/abnormal call has none, so
  // we surface its outcome label instead (e.g. "No answer", "Busy").
  const answered = call.duration_seconds !== null;
  return (
    <div className="flex flex-col gap-1">
      {/* The summary header deep-links to this call in the Phone tab (select
          the thread + scroll to the call). The inline players below sit
          OUTSIDE the link so their controls don't trigger navigation. */}
      <Link
        href={`/phone?conversation=${call.conversationId}&call=${call.id}`}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <DirectionIcon
          size={14}
          aria-label={incoming ? "Incoming call" : "Outgoing call"}
        />
        <span className="font-medium text-foreground/70">
          {call.counterpartyLabel}
        </span>
        <span>{format(new Date(call.started_at), "MMM d, h:mm a")}</span>
        {answered ? (
          <span>{formatDuration(call.duration_seconds as number)}</span>
        ) : call.status ? (
          <span>{formatCallStatus(call.status)}</span>
        ) : null}
      </Link>
      {call.recording?.audio_storage_path ? (
        <CallAudioPlayer
          storagePath={call.recording.audio_storage_path}
          label="Call recording"
        />
      ) : null}
      {call.voicemail ? (
        <div className="w-full max-w-sm rounded-lg border border-border bg-background p-2 text-xs">
          {call.voicemail.audio_storage_path ? (
            <CallAudioPlayer
              storagePath={call.voicemail.audio_storage_path}
              label="Voicemail recording"
            />
          ) : null}
          {call.voicemail.transcript_status === "ready" &&
          call.voicemail.transcript ? (
            <p className="mt-1 text-foreground">{call.voicemail.transcript}</p>
          ) : null}
          {call.voicemail.transcript_status === "pending" ? (
            <p className="mt-1 italic text-muted-foreground">Transcribing…</p>
          ) : null}
          {call.voicemail.transcript_status === "failed" ? (
            <p className="mt-1 italic text-muted-foreground">
              Transcript unavailable
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// <audio> player for a stored recording/voicemail MP3. Fetches a short-lived
// signed URL on mount (the same /api/phone/recordings?path= route the Phone-tab
// players use) and renders the native control once it resolves.
function CallAudioPlayer({
  storagePath,
  label,
}: {
  storagePath: string;
  label: string;
}) {
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
    <audio controls src={url ?? undefined} aria-label={label} className="w-full" />
  );
}
