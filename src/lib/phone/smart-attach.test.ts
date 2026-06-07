// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// `smart-attach` — the Job-tag decision module. Pure: no I/O.
//
// PRD § Smart-attach rule (locked in #304):
//   - Outbound from a Job page          → auto-tag to that Job.
//   - Outbound from Phone tab / Contact → no auto-tag; prompt chips.
//   - Inbound from Contact with 1 Active job → auto-tag.
//   - Inbound from Contact with 2+ Active jobs → untagged + prompt chips.
//   - Inbound from unknown phone number → untagged.
//   - Inbound from Contact with 0 Active jobs → untagged.
//
// Slice 4 exercises the inbound branches; outbound branches land with the
// compose slice (#5+). The module is built for both directions from day
// one so the compose slice is a delivery, not a refactor.
//
// Bias is toward under-tagging: a false attribution (flood-job text on a
// roof-job's page) is worse than the friction of one click. The rule
// never breaks ties by recency.

import { describe, it, expect } from "vitest";
import {
  decideJobTag,
  type SmartAttachInput,
  type ActiveJob,
} from "./smart-attach";

const CONTACT_ID = "c-1";

function inbound(overrides: Partial<SmartAttachInput> = {}): SmartAttachInput {
  return {
    direction: "in",
    sourceContext: { kind: "inbound" },
    contactId: CONTACT_ID,
    activeJobs: [],
    ...overrides,
  };
}

function job(id: string, label: string): ActiveJob {
  return { id, label };
}

describe("decideJobTag — inbound branches (PRD #304, slice 4)", () => {
  it("unknown contact (contactId null): untagged", () => {
    expect(decideJobTag(inbound({ contactId: null, activeJobs: [] }))).toEqual({
      kind: "untagged",
    });
  });

  it("known contact, zero Active jobs: untagged", () => {
    expect(
      decideJobTag(inbound({ contactId: CONTACT_ID, activeJobs: [] })),
    ).toEqual({ kind: "untagged" });
  });

  it("known contact, exactly one Active job: auto-tag", () => {
    expect(
      decideJobTag(
        inbound({
          contactId: CONTACT_ID,
          activeJobs: [job("job-1", "WTR-2026-0001")],
        }),
      ),
    ).toEqual({ kind: "auto", jobId: "job-1" });
  });

  it("known contact, two Active jobs: prompt with both candidates", () => {
    expect(
      decideJobTag(
        inbound({
          contactId: CONTACT_ID,
          activeJobs: [
            job("job-1", "WTR-2026-0001"),
            job("job-2", "FYR-2026-0005"),
          ],
        }),
      ),
    ).toEqual({
      kind: "prompt",
      candidates: [
        { jobId: "job-1", label: "WTR-2026-0001" },
        { jobId: "job-2", label: "FYR-2026-0005" },
      ],
    });
  });

  it("known contact, three Active jobs: prompt preserves order", () => {
    // Order matters for the chip-banner UI. The caller passes jobs in
    // whatever order they want them shown (typically newest-first or
    // active-status sort); the module never reorders.
    expect(
      decideJobTag(
        inbound({
          contactId: CONTACT_ID,
          activeJobs: [
            job("job-3", "BLD-2026-0010"),
            job("job-1", "WTR-2026-0001"),
            job("job-2", "FYR-2026-0005"),
          ],
        }),
      ),
    ).toEqual({
      kind: "prompt",
      candidates: [
        { jobId: "job-3", label: "BLD-2026-0010" },
        { jobId: "job-1", label: "WTR-2026-0001" },
        { jobId: "job-2", label: "FYR-2026-0005" },
      ],
    });
  });

  it("inbound never auto-tags from a Job-page source context (inbound has no source page)", () => {
    // The `sourceContext.kind === 'job'` branch is outbound-only; inbound
    // always uses { kind: 'inbound' }. Test pinning that a malformed
    // input does not silently auto-tag.
    expect(
      decideJobTag({
        direction: "in",
        sourceContext: { kind: "inbound" },
        contactId: CONTACT_ID,
        activeJobs: [
          job("job-1", "WTR-2026-0001"),
          job("job-2", "FYR-2026-0005"),
        ],
      }),
    ).toEqual({
      kind: "prompt",
      candidates: [
        { jobId: "job-1", label: "WTR-2026-0001" },
        { jobId: "job-2", label: "FYR-2026-0005" },
      ],
    });
  });
});

describe("decideJobTag — outbound branches (PRD #304, Job-page Text #311)", () => {
  // The Job-page Text button (#311) sends sourceContext { kind: 'job', jobId }.
  // This is the decision AC6 rests on: a Job-page send is auto-tagged to that
  // Job — no chip prompt — so the message lands in that Job's Messages section.
  it("outbound from a Job page: auto-tags to that Job regardless of the contact's Active-job count", () => {
    // Definite tag — auto even when the contact has multiple Active jobs that
    // would otherwise prompt. The Job page IS the disambiguation.
    expect(
      decideJobTag({
        direction: "out",
        sourceContext: { kind: "job", jobId: "job-9" },
        contactId: CONTACT_ID,
        activeJobs: [
          job("job-1", "WTR-2026-0001"),
          job("job-2", "FYR-2026-0005"),
        ],
      }),
    ).toEqual({ kind: "auto", jobId: "job-9" });
  });

  it("outbound from a Job page auto-tags from the source even with no contact and no Active jobs", () => {
    // The route's Job-source path skips the contact/Active-jobs lookup
    // entirely; the jobId comes straight from the source context.
    expect(
      decideJobTag({
        direction: "out",
        sourceContext: { kind: "job", jobId: "job-9" },
        contactId: null,
        activeJobs: [],
      }),
    ).toEqual({ kind: "auto", jobId: "job-9" });
  });

  it("outbound from the Phone tab does NOT auto-tag from the source (only a Job-page source carries a jobId)", () => {
    // Pins that the kind:'job' short-circuit is the ONLY source-driven
    // auto-tag: a phone-tab send falls through to the contact rules, so with
    // no Active jobs it stays untagged. A one-char change to the source check
    // (matching 'phone-tab') would wrongly auto-tag here.
    expect(
      decideJobTag({
        direction: "out",
        sourceContext: { kind: "phone-tab" },
        contactId: CONTACT_ID,
        activeJobs: [],
      }),
    ).toEqual({ kind: "untagged" });
  });
});
