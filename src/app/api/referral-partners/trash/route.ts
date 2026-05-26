// GET /api/referral-partners/trash — list Referral Partners currently in
// the Trash, after first auto-purging anything that has been trashed for
// more than 30 days.
//
// This is the same lazy-purge pattern Build 66 introduced for jobs (see
// src/app/api/jobs/trash/route.ts): every fetch of the Trash view is the
// trigger for the sweep, so a deleted partner that nobody ever revisits
// still ages out the next time an admin / crew_lead opens Trash. No
// scheduled cron, no parallel mechanism.
//
// On hard-delete: `referral_partner_calls` rows cascade away (FK was
// ON DELETE CASCADE in build78); `contacts.referral_partner_id` is set
// to NULL on linked Referral Contacts (FK was ON DELETE SET NULL in
// build78) — the contact rows themselves survive (PRD #249 user story
// #23, issue #256 AC).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";

const RETENTION_DAYS = 30;

export const GET = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (_request, { supabase }) => {
    const cutoffIso = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 1. Find anything past the 30-day window. RLS scopes to the Active
    //    Organization, so we only see (and only touch) rows the caller is
    //    allowed to manage.
    const { data: expired, error: expiredError } = await supabase
      .from("referral_partners")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoffIso);
    if (expiredError) {
      return apiDbError(
        expiredError.message,
        "GET /api/referral-partners/trash list expired",
      );
    }

    // 2. Hard-delete each expired row. The FKs do the rest:
    //      referral_partner_calls  → ON DELETE CASCADE  (rows go away)
    //      contacts.referral_partner_id → ON DELETE SET NULL (contacts survive)
    //    One row at a time so a single failure doesn't strand the others.
    let autoPurged = 0;
    for (const row of expired ?? []) {
      const { error } = await supabase
        .from("referral_partners")
        .delete()
        .eq("id", row.id);
      if (!error) autoPurged += 1;
    }

    // 3. List what's left in the Trash.
    const { data: trashed, error } = await supabase
      .from("referral_partners")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) {
      return apiDbError(error.message, "GET /api/referral-partners/trash list");
    }
    return NextResponse.json({
      referral_partners: trashed ?? [],
      autoPurged,
      retentionDays: RETENTION_DAYS,
    });
  },
);
