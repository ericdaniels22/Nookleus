import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";
import {
  CALL_OUTCOMES,
  recomputeDenormalizedFields,
  type CallLogEntry,
  type CallOutcome,
} from "@/lib/referral-partner-call";

// /api/referral-partners/[id]/calls — Call log endpoints (PRD #249, issue #254).
//
// GET — list the partner's call history, newest first.
// POST — insert a `referral_partner_calls` row scoped to the Active
//        Organization and recompute the partner's denormalized
//        `last_called_at` / `last_call_outcome` / `next_follow_up_at`
//        columns in the same request. Both endpoints are gated on
//        EDIT_REFERRAL_PARTNERS so a crew_member receives 403 before
//        the body is parsed (fee/lifecycle data is admin/crew_lead only).
//
// Validation lives inline because the surface is small (one enum check,
// one shape check) — the load-bearing pure logic is the denormalization
// rule in `referral-partner-call.ts`, exhaustively tested there.

interface LogCallBody {
  outcome?: unknown;
  notes?: unknown;
  follow_up_at?: unknown;
  referral_contact_id?: unknown;
}

function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === "string" && (CALL_OUTCOMES as readonly string[]).includes(v);
}

function nullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const GET = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (
    _request,
    { supabase },
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const { data, error } = await supabase
      .from("referral_partner_calls")
      .select("*")
      .eq("referral_partner_id", id)
      .order("called_at", { ascending: false });
    if (error) {
      return apiDbError(error.message, "GET /api/referral-partners/[id]/calls");
    }
    return NextResponse.json({ calls: data ?? [] });
  },
);

export const POST = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (
    request,
    { supabase, orgId, userId },
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const raw = (await request.json()) as LogCallBody;

    if (!isCallOutcome(raw.outcome)) {
      return NextResponse.json(
        { error: "Unknown call outcome" },
        { status: 400 },
      );
    }
    if (!orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 400 },
      );
    }

    const calledAt = new Date().toISOString();
    const followUpAt = nullableString(raw.follow_up_at);
    const referralContactId = nullableString(raw.referral_contact_id);

    // 1. Insert the call. RLS scopes both this insert and the subsequent
    //    select-back to the Active Organization; an id from another Org
    //    would silently fail the WITH CHECK and short-circuit before any
    //    denormalization happens.
    const { data: insertedCall, error: insertError } = await supabase
      .from("referral_partner_calls")
      .insert({
        organization_id: orgId,
        referral_partner_id: id,
        referral_contact_id: referralContactId,
        user_id: userId,
        called_at: calledAt,
        outcome: raw.outcome,
        notes: nullableString(raw.notes),
        follow_up_at: followUpAt,
      })
      .select("*")
      .single();
    if (insertError) {
      return apiDbError(
        insertError.message,
        "POST /api/referral-partners/[id]/calls insert",
      );
    }

    // 2. Read every call for the partner and recompute the denormalized
    //    fields via the pure rule. This is the load-bearing contract from
    //    issue #254 — list-page queries depend on these three columns.
    const { data: allCalls, error: readError } = await supabase
      .from("referral_partner_calls")
      .select("id, referral_partner_id, called_at, outcome, follow_up_at")
      .eq("referral_partner_id", id);
    if (readError) {
      return apiDbError(
        readError.message,
        "POST /api/referral-partners/[id]/calls read-back",
      );
    }

    const denormalized = recomputeDenormalizedFields(
      (allCalls ?? []) as CallLogEntry[],
      { now: calledAt },
    );

    // 3. Write the denormalized fields back to the parent partner row.
    //    The update is fire-and-forget from the caller's POV — if it
    //    fails, the call row still exists and the next log-a-call will
    //    recompute from the full history.
    const { error: updateError } = await supabase
      .from("referral_partners")
      .update(denormalized)
      .eq("id", id);
    if (updateError) {
      return apiDbError(
        updateError.message,
        "POST /api/referral-partners/[id]/calls denormalize",
      );
    }

    return NextResponse.json({ call: insertedCall }, { status: 201 });
  },
);
