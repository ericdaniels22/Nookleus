// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// `route-inbound` — the pure decision tree for an inbound SMS. Given the
// Twilio payload (which contains a `From` E.164 of the outside party and a
// `To` E.164 of one of our `phone_numbers`), the org's `phone_numbers`
// rows, the org's contacts indexed by phone, and the contacts' Active
// jobs, it decides:
//
//   - which `phone_numbers` row received the inbound (matched by `To`),
//   - which Contact (if any) sent it (matched by `From` via phone-format),
//   - which conversation-key it lands in (by `phone_number_id` +
//     outside_e164), and
//   - what the smart-attach decision is (delegated).
//
// I/O (signature validation, persistence) is separate: the webhook route
// is a thin shell on top of this function.

import { describe, it, expect } from "vitest";
import { routeInbound, type RouteInboundInput } from "./route-inbound";

const ORG = "org-1";
const SHARED_NUMBER_ID = "pn-shared-1";
const SHARED_E164 = "+15125550000";
const OUTSIDE_E164 = "+15551234567";
const CONTACT_ID = "c-1";

function defaultInput(overrides: Partial<RouteInboundInput> = {}): RouteInboundInput {
  return {
    payload: {
      From: OUTSIDE_E164,
      To: SHARED_E164,
      Body: "hello",
    },
    orgNumbers: [
      {
        id: SHARED_NUMBER_ID,
        organization_id: ORG,
        e164: SHARED_E164,
        kind: "shared",
        user_id: null,
      },
    ],
    contacts: [],
    activeJobsByContact: {},
    ...overrides,
  };
}

describe("routeInbound", () => {
  it("returns null when no org number matches the To address", () => {
    expect(
      routeInbound({
        payload: { From: OUTSIDE_E164, To: "+19999999999", Body: "x" },
        orgNumbers: [
          {
            id: SHARED_NUMBER_ID,
            organization_id: ORG,
            e164: SHARED_E164,
            kind: "shared",
            user_id: null,
          },
        ],
        contacts: [],
        activeJobsByContact: {},
      }),
    ).toBeNull();
  });

  it("unknown contact: returns null contactId + untagged smart-attach", () => {
    const result = routeInbound(defaultInput());
    expect(result).not.toBeNull();
    expect(result).toEqual({
      organizationId: ORG,
      phoneNumberId: SHARED_NUMBER_ID,
      phoneNumberKind: "shared",
      phoneNumberOwnerId: null,
      outsideE164: OUTSIDE_E164,
      conversationKey: { phoneNumberId: SHARED_NUMBER_ID, outsideE164: OUTSIDE_E164 },
      contactId: null,
      smartAttach: { kind: "untagged" },
    });
  });

  it("known contact, one Active job: auto-tag", () => {
    const result = routeInbound(
      defaultInput({
        contacts: [{ id: CONTACT_ID, phone: "(555) 123-4567" }],
        activeJobsByContact: {
          [CONTACT_ID]: [{ id: "job-1", label: "WTR-2026-0001" }],
        },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.contactId).toBe(CONTACT_ID);
    expect(result!.smartAttach).toEqual({ kind: "auto", jobId: "job-1" });
  });

  it("known contact, two Active jobs: prompt with both candidates", () => {
    const result = routeInbound(
      defaultInput({
        contacts: [{ id: CONTACT_ID, phone: "+15551234567" }],
        activeJobsByContact: {
          [CONTACT_ID]: [
            { id: "job-1", label: "WTR-2026-0001" },
            { id: "job-2", label: "FYR-2026-0005" },
          ],
        },
      }),
    );
    expect(result!.contactId).toBe(CONTACT_ID);
    expect(result!.smartAttach).toEqual({
      kind: "prompt",
      candidates: [
        { jobId: "job-1", label: "WTR-2026-0001" },
        { jobId: "job-2", label: "FYR-2026-0005" },
      ],
    });
  });

  it("known contact, zero Active jobs: untagged", () => {
    const result = routeInbound(
      defaultInput({
        contacts: [{ id: CONTACT_ID, phone: "5551234567" }],
        activeJobsByContact: { [CONTACT_ID]: [] },
      }),
    );
    expect(result!.contactId).toBe(CONTACT_ID);
    expect(result!.smartAttach).toEqual({ kind: "untagged" });
  });

  it("inbound to a Personal number: phoneNumberOwnerId is the owner", () => {
    const result = routeInbound({
      payload: { From: OUTSIDE_E164, To: "+15125550001", Body: "x" },
      orgNumbers: [
        {
          id: "pn-personal-1",
          organization_id: ORG,
          e164: "+15125550001",
          kind: "personal",
          user_id: "user-alice",
        },
      ],
      contacts: [],
      activeJobsByContact: {},
    });
    expect(result).not.toBeNull();
    expect(result!.phoneNumberKind).toBe("personal");
    expect(result!.phoneNumberOwnerId).toBe("user-alice");
  });

  it("ignores released numbers when matching", () => {
    // A released number's row stays for audit but should not receive
    // new inbound. The webhook should treat a To-match against a released
    // row as a no-op.
    const result = routeInbound({
      payload: { From: OUTSIDE_E164, To: SHARED_E164, Body: "x" },
      orgNumbers: [
        {
          id: SHARED_NUMBER_ID,
          organization_id: ORG,
          e164: SHARED_E164,
          kind: "shared",
          user_id: null,
          released_at: "2026-05-01T00:00:00Z",
        },
      ],
      contacts: [],
      activeJobsByContact: {},
    });
    expect(result).toBeNull();
  });
});
