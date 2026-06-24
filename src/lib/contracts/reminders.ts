import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailTemplate } from "./email-merge-fields";
import { sendContractEmail } from "./email";
import { renderBrandedContractEmail } from "./branded-email";
import type { Contract, ContractEmailSettings, ContractSigner } from "./types";

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

// The "active" signer for a contract awaiting signatures = the lowest
// signer_order that hasn't signed yet. In single-signer contracts that's
// signer 1. In multi-signer, it flips from 1 → 2 as each completes.
export function pickActiveSigner(signers: ContractSigner[]): ContractSigner | null {
  const sorted = [...signers].sort((a, b) => a.signer_order - b.signer_order);
  for (const s of sorted) {
    if (!s.signed_at) return s;
  }
  return null;
}

export interface SendReminderResult {
  ok: true;
  messageId: string;
  signerEmail: string;
}

// Sends exactly one reminder email for a contract and atomically records
// the reminder_sent event + bumps reminder_count + reschedules next via
// the mark_reminder_sent RPC. Caller is responsible for the dedup check
// (cron) or for bypass intent (manual Remind button, which should NOT
// shift next_reminder_at — manual path uses its own skipSchedule option).
export async function sendContractReminder(
  supabase: SupabaseClient,
  contract: Contract,
  signers: ContractSigner[],
  settings: ContractEmailSettings,
  opts: { skipSchedule?: boolean } = {},
): Promise<SendReminderResult> {
  if (!contract.link_token) {
    throw new Error("Contract has no active signing link");
  }
  const active = pickActiveSigner(signers);
  if (!active) throw new Error("No active (unsigned) signer to remind");

  const signingLink = `${appUrl()}/sign/${contract.link_token}`;
  const { subject, html: message } = await resolveEmailTemplate(
    supabase,
    settings.reminder_subject_template,
    settings.reminder_body_template,
    contract.job_id,
    { signing_link: signingLink, document_title: contract.title },
  );

  // Assemble the app-owned card AROUND the message (#692, ADR 0017 §3). The
  // reminder shares the frame, button, and signing link; only its own
  // message/subject and the reminder headline/icon differ. This is the
  // chokepoint for both reminder paths — the hourly cron and the manual Remind
  // button — so framing here brands both at once.
  const html = await renderBrandedContractEmail(supabase, settings, {
    kind: "reminder",
    organizationId: contract.organization_id,
    message,
    actionUrl: signingLink,
    documentTitle: contract.title,
  });

  const sent = await sendContractEmail(supabase, settings, {
    to: active.email,
    subject,
    html,
  });

  if (opts.skipSchedule) {
    // Manual reminder path: audit only, don't touch counter or schedule.
    const { error } = await supabase.from("contract_events").insert({
      organization_id: contract.organization_id,
      contract_id: contract.id,
      signer_id: active.id,
      event_type: "reminder_sent",
      metadata: { manual: true, message_id: sent.messageId },
    });
    if (error) throw new Error(`Failed to log reminder_sent: ${error.message}`);
  } else {
    const { error: rpcErr } = await supabase.rpc("mark_reminder_sent", {
      p_contract_id: contract.id,
      p_offsets: settings.reminder_day_offsets,
    });
    if (rpcErr) throw new Error(`Failed to record reminder: ${rpcErr.message}`);
  }

  return { ok: true, messageId: sent.messageId, signerEmail: active.email };
}

// Convert reminder_day_offsets + sent_at into the initial next_reminder_at.
// Returns null if offsets is empty (no auto-reminders configured).
export function computeInitialNextReminderAt(
  sentAt: Date,
  offsets: number[],
): Date | null {
  if (!offsets || offsets.length === 0) return null;
  const first = Number(offsets[0]);
  if (!Number.isFinite(first) || first <= 0) return null;
  return new Date(sentAt.getTime() + first * 24 * 60 * 60 * 1000);
}

// Guard used by the cron handler: returns true if a reminder_sent event
// already exists for this contract within the last hour. Protects against
// Vercel firing the cron twice in the same window.
export async function hasRecentReminder(
  supabase: SupabaseClient,
  contractId: string,
  withinMs: number = 60 * 60 * 1000,
): Promise<boolean> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count, error } = await supabase
    .from("contract_events")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId)
    .eq("event_type", "reminder_sent")
    .gte("created_at", since);
  if (error) throw new Error(`Failed to check recent reminders: ${error.message}`);
  return (count ?? 0) > 0;
}
