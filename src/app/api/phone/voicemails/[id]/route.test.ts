// PRD #304 — Nookleus Phone. Slice 10 (#313) — delete-voicemail route.
//
// DELETE /api/phone/voicemails/[id]
// canManage-gated (mirrors numbers/[id]/release): Shared is admin-only,
// Personal is owner-or-admin. The number kind/owner is resolved by joining
// the voicemail → its parent call → conversation → phone_number through the
// Service client, exactly like the re-tag route.
//
// Ordering: Twilio first, DB second (then a best-effort Storage cleanup).
// Twilio's recording is the retention-relevant thing (PRD #304 story 54) — a
// successful Twilio hard-delete + DB-write failure is recoverable (admin
// retries; Twilio's remove of an already-removed SID errors cleanly). The
// reverse — row gone, recording still on Twilio — silently keeps a recording
// Nookleus believes it deleted, so we refuse to touch the DB until Twilio
// confirms (502 on Twilio failure leaves the row untouched).

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

const deleteRecordingMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  deleteRecording: (...args: unknown[]) => deleteRecordingMock(...args),
  createTwilioClient: () => ({}),
}));

import { DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const VOICEMAIL_ROW = {
  id: "vm-1",
  organization_id: "org-1",
  phone_call_id: "call-1",
  twilio_recording_sid: "REabc",
  audio_storage_path: "org-1/rec-1.mp3",
};
const CALL_ROW = {
  id: "call-1",
  organization_id: "org-1",
  conversation_id: "conv-1",
};
const CONVERSATION_ROW = {
  id: "conv-1",
  organization_id: "org-1",
  phone_number_id: "num-1",
};
// Shared number — admin-only manage.
const SHARED_NUMBER = {
  id: "num-1",
  organization_id: "org-1",
  kind: "shared" as const,
  user_id: null,
};

// A Service client over the 4 tables the route joins, with spies on the
// voicemail-row delete and the Storage-object remove so a test can assert
// ordering (the DB delete must NOT fire when Twilio errors) and cleanup.
function instrumentedService(
  overrides: {
    voicemail?: Record<string, unknown> | null;
    number?: Record<string, unknown>;
  } = {},
) {
  const voicemail =
    overrides.voicemail === undefined ? VOICEMAIL_ROW : overrides.voicemail;
  const tables: Record<string, Record<string, unknown>[]> = {
    phone_voicemails: voicemail ? [voicemail] : [],
    phone_calls: [CALL_ROW],
    phone_conversations: [CONVERSATION_ROW],
    phone_numbers: [overrides.number ?? SHARED_NUMBER],
  };
  const svc = fakeServiceClient({ tables }) as unknown as {
    from: (table: string) => Record<string, unknown>;
    storage: unknown;
  };
  const deleteSpy = vi.fn();
  const removeSpy = vi.fn(async () => ({ data: [], error: null }));
  const origFrom = svc.from.bind(svc);
  svc.from = (table: string) => {
    const builder = origFrom(table) as Record<string, unknown> & {
      delete: (...a: unknown[]) => unknown;
    };
    if (table === "phone_voicemails") {
      const origDelete = builder.delete.bind(builder);
      builder.delete = (...a: unknown[]) => {
        deleteSpy(...a);
        return origDelete(...a);
      };
    }
    return builder;
  };
  svc.storage = {
    from: () => ({
      remove: removeSpy,
      async download() {
        return { data: null, error: { message: "not found" } };
      },
      async upload() {
        return { data: null, error: null };
      },
    }),
  };
  return { svc, deleteSpy, removeSpy };
}

function serviceReturns(svc: unknown) {
  vi.mocked(createServiceClient).mockReturnValue(svc as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  serviceReturns(instrumentedService().svc);
  deleteRecordingMock.mockResolvedValue(undefined);
});

describe("DELETE /api/phone/voicemails/[id]", () => {
  it("admin deletes a Shared voicemail: hard-deletes the Twilio recording, then 200", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(deleteRecordingMock).toHaveBeenCalledWith(
      expect.anything(),
      "REabc",
    );
  });

  it("403 when the caller lacks view_phone (permission gate, before any lookup)", async () => {
    const { svc, deleteSpy } = instrumentedService();
    serviceReturns(svc);
    authed({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(403);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("view_phone holder who is not an admin cannot delete a Shared voicemail: 403, no Twilio remove, DB untouched", async () => {
    const { svc, deleteSpy } = instrumentedService();
    serviceReturns(svc);
    authed({
      user: { id: "lead-1" },
      tables: memberTables({
        userId: "lead-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(403);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("404 when the voicemail does not exist", async () => {
    const { svc } = instrumentedService({ voicemail: null });
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(404);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
  });

  it("404 when the voicemail belongs to another org (no cross-org reach)", async () => {
    const { svc, deleteSpy } = instrumentedService({
      voicemail: { ...VOICEMAIL_ROW, organization_id: "org-2" },
    });
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(404);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("Twilio failure → 502 and the DB row is left untouched", async () => {
    const { svc, deleteSpy } = instrumentedService();
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    deleteRecordingMock.mockRejectedValue(new Error("Twilio 500"));

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(502);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("voicemail with no Twilio recording sid: skips the Twilio hop, still deletes + 200", async () => {
    const { svc, deleteSpy } = instrumentedService({
      voicemail: { ...VOICEMAIL_ROW, twilio_recording_sid: null },
    });
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("Personal-number owner (non-admin) can delete their own voicemail", async () => {
    const { svc, deleteSpy } = instrumentedService({
      number: {
        id: "num-1",
        organization_id: "org-1",
        kind: "personal" as const,
        user_id: "owner-1",
      },
    });
    serviceReturns(svc);
    authed({
      user: { id: "owner-1" },
      tables: memberTables({
        userId: "owner-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("non-owner non-admin cannot delete someone else's Personal voicemail: 403", async () => {
    const { svc, deleteSpy } = instrumentedService({
      number: {
        id: "num-1",
        organization_id: "org-1",
        kind: "personal" as const,
        user_id: "owner-1",
      },
    });
    serviceReturns(svc);
    authed({
      user: { id: "intruder-1" },
      tables: memberTables({
        userId: "intruder-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(403);
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("also removes the stored audio copy from the phone-recordings bucket", async () => {
    const { svc, removeSpy } = instrumentedService();
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith(["org-1/rec-1.mp3"]);
  });

  it("storage cleanup failure does not fail the delete (best-effort): still 200", async () => {
    const { svc, removeSpy, deleteSpy } = instrumentedService();
    removeSpy.mockRejectedValueOnce(new Error("storage offline"));
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("voicemail with no stored audio path: skips storage cleanup, still 200", async () => {
    const { svc, removeSpy } = instrumentedService({
      voicemail: { ...VOICEMAIL_ROW, audio_storage_path: null },
    });
    serviceReturns(svc);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await DELETE(
      new Request("http://test", { method: "DELETE" }),
      idParams("vm-1"),
    );

    expect(res.status).toBe(200);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
