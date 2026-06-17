// New-intake dispatcher: the server-side reaction to a hand-logged Intake.
// Given the freshly-inserted Job, it loads the Job + its Contact, builds the
// per-Urgency buzz-wording, and fans out one `new_job` in-app bell row to every
// active member of the Job's Organization except the submitter.
//
// Best-effort by contract: a failed notify must NEVER break Intake submission
// (the Job is already saved). This function therefore swallows every error and
// never throws. See docs/adr/0016-new-intake-push-notifications.md.

import { createServiceClient } from "@/lib/supabase-api";

import { buildIntakeBuzz, type IntakeUrgency } from "./intake-buzz";
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

    await writeNotification({
      type: "new_job",
      title: buzz.title,
      body: buzz.body,
      href: buzz.href,
      jobId: job.id,
      organizationId: job.organization_id,
      audience: "members",
      excludeUserId: input.submitterUserId,
    });
  } catch (err) {
    // Best-effort: never let a notify failure surface to the Intake flow.
    console.error("[new-intake notify] dispatch failed:", err);
  }
}
