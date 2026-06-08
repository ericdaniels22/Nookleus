// PRD #304 — Nookleus Phone. The Job-tag decision module. Pure: no I/O,
// no Supabase, no HTTP. Given a message direction, source context,
// contact, and the contact's Active jobs, decide whether to auto-tag,
// prompt with chips, or leave untagged.
//
// Locked rule (PRD #304):
//   Outbound from a Job page                      → auto-tag to that Job.
//   Outbound from Phone tab / Contact card        → prompt chips.
//   Inbound from Contact with 1 Active job        → auto-tag.
//   Inbound from Contact with 2+ Active jobs      → prompt chips.
//   Inbound from Contact with 0 Active jobs       → untagged.
//   Inbound from an unknown number (contactId null) → untagged.
//
// Bias toward under-tagging: never break ties by recency. A false
// attribution (flood-job text on a roof-job's page) is worse than the
// friction of one click. The decision is reversible — slice 9 wires the
// "re-tag" action that overrides any auto / prompt outcome.

export type SmartAttachDirection = "in" | "out";

// The source context the message was composed from. Outbound has three
// shapes (Job page, Phone tab, Contact card); inbound always carries
// `{ kind: 'inbound' }`. Slice 4 exercises only the inbound shape; the
// outbound shapes ship now so slice 5+ is a delivery.
export type SmartAttachSource =
  | { kind: "inbound" }
  | { kind: "job"; jobId: string }
  | { kind: "phone-tab" }
  | { kind: "contact-card" };

export interface ActiveJob {
  id: string;
  // Human-readable label shown in the chip banner (the job_number).
  label: string;
}

export interface SmartAttachInput {
  direction: SmartAttachDirection;
  sourceContext: SmartAttachSource;
  // Null when inbound from an unknown phone number; the route-inbound
  // module is responsible for the lookup.
  contactId: string | null;
  // The Contact's Active jobs (status not in 'completed' | 'cancelled');
  // empty when the contact has none. Order is preserved into the
  // `candidates` array for the chip banner.
  activeJobs: ActiveJob[];
}

export type SmartAttachDecision =
  | { kind: "auto"; jobId: string }
  | { kind: "prompt"; candidates: Array<{ jobId: string; label: string }> }
  | { kind: "untagged" };

export function decideJobTag(input: SmartAttachInput): SmartAttachDecision {
  // Outbound from a Job page is definite — auto-tag regardless of
  // contact's Active-job count.
  if (input.direction === "out" && input.sourceContext.kind === "job") {
    return { kind: "auto", jobId: input.sourceContext.jobId };
  }

  // Unknown contact: nothing to tag against.
  if (input.contactId === null) {
    return { kind: "untagged" };
  }

  // Known contact: depends on Active-job count.
  if (input.activeJobs.length === 0) {
    return { kind: "untagged" };
  }
  // A single Active job auto-tags ONLY for inbound. An outbound send from the
  // Phone tab / Contact card must prompt even here — the locked rule is
  // "Outbound from Phone tab / Contact card → prompt chips" (#530). The
  // Job-page outbound source (kind:'job') already returned above, so any
  // outbound reaching this point is a non-Job source that must never
  // auto-tag: a false attribution is worse than the friction of one click.
  if (input.direction === "in" && input.activeJobs.length === 1) {
    return { kind: "auto", jobId: input.activeJobs[0].id };
  }
  return {
    kind: "prompt",
    candidates: input.activeJobs.map((j) => ({ jobId: j.id, label: j.label })),
  };
}
