// PRD #304 — Nookleus Phone. Slice 8 (#312).
//
// GET /api/phone/conversations/[id]/calls — return the voice calls in the
// conversation, sorted by `started_at` ascending. The Phone-tab thread
// fetches this alongside /messages and interleaves the two (mergeThreadItems).
// RLS enforces the ADR 0003 matrix; the route is a thin pass-through —
// additive, leaving the messages route untouched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/phone/conversations/[id]/calls", () => {
  it("returns 401 unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks view_phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
      }) as never,
    );
    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(403);
  });

  it("returns the conversation's calls for an authorized caller", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_calls = [
      {
        id: "call-1",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "in",
        from_e164: "+15551234567",
        to_e164: "+15125550000",
        status: "completed",
        duration_seconds: 42,
        job_tag: null,
        started_at: "2026-05-27T10:00:00Z",
        ended_at: "2026-05-27T10:00:42Z",
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      expect.objectContaining({
        id: "call-1",
        direction: "in",
        status: "completed",
        duration_seconds: 42,
      }),
    ]);
  });

  // Slice 9 (#313) — a call that went to voicemail carries its recording +
  // transcript inline. Supabase embeds the related phone_voicemails row(s)
  // under the embed key; the route flattens the (0-or-1, UNIQUE per call)
  // result to a single `voicemail` field so the client gets a clean
  // `voicemail | null` rather than a PostgREST array.
  it("flattens an embedded voicemail onto the call as `voicemail`", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_calls = [
      {
        id: "call-vm",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "in",
        status: "no_answer",
        duration_seconds: 18,
        started_at: "2026-05-27T10:00:00Z",
        ended_at: "2026-05-27T10:00:18Z",
        // PostgREST returns the embed as an array (FK on the child table).
        phone_voicemails: [
          {
            id: "vm-1",
            audio_storage_path: "org-1/rec-1.mp3",
            transcript: "Hi, please call me back about the roof.",
            transcript_status: "ready",
            duration_seconds: 12,
          },
        ],
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].voicemail).toEqual({
      id: "vm-1",
      audio_storage_path: "org-1/rec-1.mp3",
      transcript: "Hi, please call me back about the roof.",
      transcript_status: "ready",
      duration_seconds: 12,
    });
    // The raw PostgREST embed key is gone — the client sees only `voicemail`.
    expect("phone_voicemails" in body[0]).toBe(false);
  });

  it("sets voicemail to null for a call with no recording", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_calls = [
      {
        id: "call-plain",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "out",
        status: "completed",
        duration_seconds: 30,
        started_at: "2026-05-27T11:00:00Z",
        ended_at: "2026-05-27T11:00:30Z",
        phone_voicemails: [],
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].voicemail).toBeNull();
  });

  // Slice 11 (#315) — an answered call carries its recording inline so the
  // thread can render a play control on the call event. Same flatten as
  // voicemail: PostgREST embeds the (0-or-1, UNIQUE per call) phone_recordings
  // row; the route collapses it to a single `recording` field.
  it("flattens an embedded recording onto the call as `recording`", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_calls = [
      {
        id: "call-rec",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "out",
        status: "completed",
        duration_seconds: 42,
        started_at: "2026-05-27T12:00:00Z",
        ended_at: "2026-05-27T12:00:42Z",
        phone_recordings: [
          {
            id: "rec-1",
            audio_storage_path: "org-1/rec-1.mp3",
            consent_notice_played: true,
            duration_seconds: 42,
          },
        ],
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].recording).toEqual({
      id: "rec-1",
      audio_storage_path: "org-1/rec-1.mp3",
      consent_notice_played: true,
      duration_seconds: 42,
    });
    // The raw PostgREST embed key is gone — the client sees only `recording`.
    expect("phone_recordings" in body[0]).toBe(false);
  });

  it("sets recording to null for a call with no recording", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_calls = [
      {
        id: "call-norec",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "out",
        status: "completed",
        duration_seconds: 30,
        started_at: "2026-05-27T13:00:00Z",
        ended_at: "2026-05-27T13:00:30Z",
        phone_recordings: [],
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/calls"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].recording).toBeNull();
  });
});
