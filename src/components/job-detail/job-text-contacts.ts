// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Messages section.
//
// Map a Job to the contacts its Text button offers: the homeowner first
// (the default recipient), then the Job's adjusters with the primary ahead
// of the rest. Insurance and HOA contacts are intentionally excluded. The
// Messages section filters the result down to those with a phone number.

import type { Job } from "@/lib/types";
import type { JobMessageContact } from "./job-messages-section";

export function buildJobTextContacts(
  job: Pick<Job, "contact" | "job_adjusters">,
): JobMessageContact[] {
  const contacts: JobMessageContact[] = [];

  if (job.contact) {
    contacts.push({
      id: job.contact.id,
      name: job.contact.full_name,
      phone: job.contact.phone,
    });
  }

  // Stable sort floats the primary adjuster to the front while preserving
  // the existing order among the rest (Array.prototype.sort is stable).
  const adjusters = [...(job.job_adjusters ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary),
  );
  for (const ja of adjusters) {
    // The contacts join can be absent (RLS-hidden or a deleted contact) —
    // skip those rather than surfacing a nameless recipient.
    const adjuster = ja.adjuster;
    if (!adjuster) continue;
    contacts.push({
      id: adjuster.id,
      name: adjuster.full_name,
      phone: adjuster.phone,
    });
  }

  return contacts;
}
