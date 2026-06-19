// New-intake dispatcher: the server-side reaction to a hand-logged Intake.
// Given the freshly-inserted Job, it loads the Job + its Contact, builds the
// per-Urgency buzz-wording, fans out one `new_job` in-app bell row to every
// active member of the Job's Organization except the submitter, and then buzzes
// those members' enrolled iOS devices via APNs (#673).
//
// Best-effort by contract: a failed notify must NEVER break Intake submission
// (the Job is already saved). This function therefore swallows every error and
// never throws. The in-app bell write is the primary, durable outcome; the push
// is a best-effort enhancement layered on top and is isolated so a push failure
// can never undo the bell write. See docs/adr/0018-new-intake-push-notifications.md.

import { createServiceClient } from "@/lib/supabase-api";
import { send, type ApplePushPayload, type SendDeps } from "@/lib/push/apple-sender";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildIntakeBuzz, type IntakeBuzz, type IntakeUrgency } from "./intake-buzz";
import { listDeviceTokensForUsers, pruneDeviceTokens } from "./device-tokens";
import { writeNotification } from "./write";

export interface DispatchNewIntakeInput {
  jobId: string;
  // The member who submitted the Intake — excluded from the fan-out.
  submitterUserId: string;
}

interface JobFacts {
  id: string;
  organization_id: string;
  urgency: IntakeUrgency;
  damage_type: string | null;
  property_address: string | null;
  contact_id: string | null;
}

export async function dispatchNewIntakeNotifications(
  input: DispatchNewIntakeInput,
  // APNs send dependencies (transport/config/now). Defaults to `{}` so the real
  // Apple transport + env credentials are used in production; tests inject a
  // fake transport. See src/lib/push/apple-sender.ts.
  push: SendDeps = {},
): Promise<void> {
  try {
    const supabase = createServiceClient();

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, organization_id, urgency, damage_type, property_address, contact_id")
      .eq("id", input.jobId)
      .maybeSingle<JobFacts>();
    if (jobErr) throw new Error(`job lookup: ${jobErr.message}`);
    if (!job) return; // Nothing to notify about — best-effort, stay silent.

    let customerName = "";
    if (job.contact_id) {
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("full_name")
        .eq("id", job.contact_id)
        .maybeSingle<{ full_name: string | null }>();
      if (contactErr) throw new Error(`contact lookup: ${contactErr.message}`);
      customerName = contact?.full_name ?? "";
    }

    const buzz = buildIntakeBuzz({
      jobId: job.id,
      customerName,
      urgency: job.urgency,
      damageType: job.damage_type,
      propertyAddress: job.property_address,
    });

    // The in-app bell is the primary outcome; its recipient list is the single
    // source of truth for who the buzz targets (no separate audience query).
    const recipientIds = await writeNotification({
      type: "new_job",
      title: buzz.title,
      body: buzz.body,
      href: buzz.href,
      jobId: job.id,
      organizationId: job.organization_id,
      audience: "members",
      excludeUserId: input.submitterUserId,
    });

    // Best-effort push enhancement, isolated from the bell write above: a buzz
    // failure (registry error, APNs misconfig, transport drop) must never undo
    // the durable bell record or surface to the Intake flow.
    try {
      await buzzDevices(supabase, recipientIds, buzz, push);
    } catch (pushErr) {
      console.error("[new-intake notify] push failed:", pushErr);
    }
  } catch (err) {
    // Best-effort: never let a notify failure surface to the Intake flow.
    console.error("[new-intake notify] dispatch failed:", err);
  }
}

/**
 * Best-effort push enhancement: buzz the enrolled iOS devices of the members
 * who just received the in-app bell. Looks up their device addresses, builds the
 * APNs payload from the same buzz-wording, and sends. Returns silently when no
 * targeted member has an enrolled device (web/desktop-only teams get the bell
 * and nothing more).
 */
async function buzzDevices(
  supabase: SupabaseClient,
  recipientIds: string[],
  buzz: IntakeBuzz,
  push: SendDeps,
): Promise<void> {
  const tokens = await listDeviceTokensForUsers(supabase, recipientIds);
  if (tokens.length === 0) return;

  const payload: ApplePushPayload = {
    title: buzz.title,
    body: buzz.body,
    sound: buzz.sound,
    href: buzz.href,
  };
  const result = await send(tokens, payload, push);

  // Drop the addresses Apple reported dead (unregistered / bad token) so we
  // stop buzzing uninstalled apps. See src/lib/notifications/device-tokens.ts.
  const dead = result.outcomes
    .filter((o) => o.status === "prunable")
    .map((o) => o.token);
  await pruneDeviceTokens(supabase, dead);
}
