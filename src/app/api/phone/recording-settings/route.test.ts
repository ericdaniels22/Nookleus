// PRD #304 — Nookleus Phone. Slice 11 (#315) — org recording-default settings.
//
// GET  /api/phone/recording-settings  → { recording_enabled_default: boolean }
//        (view_phone — any teammate can see whether calls record by default)
// PATCH /api/phone/recording-settings → { ok: true }
//        (admin only — changing org-wide call recording is a Shared-scope
//         admin action per ADR 0005)
//
// The value lives on organizations.recording_enabled_default (migration-315),
// read/written through the Service client scoped to the caller's Active Org.

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

import { GET, PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

// A Service client over the organizations table with an update spy so a test
// can assert the patched value.
function instrumentedService(recordingEnabledDefault: boolean) {
  const svc = fakeServiceClient({
    tables: {
      organizations: [
        { id: "org-1", recording_enabled_default: recordingEnabledDefault },
      ],
    },
  }) as unknown as { from: (table: string) => Record<string, unknown> };
  const updateSpy = vi.fn();
  const origFrom = svc.from.bind(svc);
  svc.from = (table: string) => {
    const builder = origFrom(table) as Record<string, unknown> & {
      update: (...a: unknown[]) => unknown;
    };
    if (table === "organizations") {
      const origUpdate = builder.update.bind(builder);
      builder.update = (...a: unknown[]) => {
        updateSpy(...a);
        return origUpdate(...a);
      };
    }
    return builder;
  };
  return { svc, updateSpy };
}

function patchReq(body: Record<string, unknown>) {
  return new Request("http://test/api/phone/recording-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/phone/recording-settings", () => {
  it("returns the org's recording_enabled_default for a view_phone holder", async () => {
    const { svc } = instrumentedService(true);
    vi.mocked(createServiceClient).mockReturnValue(svc as never);
    authed({
      user: { id: "lead-1" },
      tables: memberTables({
        userId: "lead-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await GET(
      new Request("http://test/api/phone/recording-settings"),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recording_enabled_default: true });
  });

  it("403 without view_phone", async () => {
    const { svc } = instrumentedService(true);
    vi.mocked(createServiceClient).mockReturnValue(svc as never);
    authed({
      user: { id: "m-1" },
      tables: memberTables({ userId: "m-1", role: "crew_member", grants: [] }),
    });

    const res = await GET(
      new Request("http://test/api/phone/recording-settings"),
      noParams,
    );

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/phone/recording-settings", () => {
  it("an admin turns the org default off", async () => {
    const { svc, updateSpy } = instrumentedService(true);
    vi.mocked(createServiceClient).mockReturnValue(svc as never);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await PATCH(patchReq({ recording_enabled_default: false }), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ recording_enabled_default: false }),
    );
  });

  it("403 for a non-admin (view_phone is not enough)", async () => {
    const { svc, updateSpy } = instrumentedService(true);
    vi.mocked(createServiceClient).mockReturnValue(svc as never);
    authed({
      user: { id: "lead-1" },
      tables: memberTables({
        userId: "lead-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await PATCH(patchReq({ recording_enabled_default: false }), noParams);

    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 when recording_enabled_default is not a boolean", async () => {
    const { svc, updateSpy } = instrumentedService(true);
    vi.mocked(createServiceClient).mockReturnValue(svc as never);
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await PATCH(patchReq({ recording_enabled_default: "nope" }), noParams);

    expect(res.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
