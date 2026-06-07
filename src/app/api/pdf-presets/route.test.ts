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
vi.mock("@/lib/pdf-presets", () => ({
  listPresets: vi.fn(),
  createPreset: vi.fn(),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listPresets, createPreset } from "@/lib/pdf-presets";
import {
  fakeUserClient,
  memberTables,
} from "../email/__test-utils__/request-context-fakes";
import type { PdfPreset } from "@/lib/types";

const noParams = { params: Promise.resolve({}) };

// A minimal valid create body — the three fields the route requires.
const VALID_POST_BODY = {
  name: "House Style",
  document_type: "estimate",
  document_title: "Estimate",
};

function postRequest(body: unknown): Request {
  return new Request("http://test/api/pdf-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(listPresets).mockResolvedValue([]);
});

describe("GET /api/pdf-presets (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(401);
    expect(listPresets).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-admin holds neither view_estimates nor view_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(403);
    expect(listPresets).not.toHaveBeenCalled();
  });

  it("allows a non-admin holding either of the two view permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["view_invoices"],
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ presets: [] });
  });

  it("allows an admin who holds no explicit grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/pdf-presets"), noParams);

    expect(res.status).toBe(200);
  });
});

// #486 — "Save as preset" reuses this POST. Its manage_pdf_presets gate is the
// server-side backstop for AC #4: an edit-only user is refused here even though
// the UI also hides the control.
describe("POST /api/pdf-presets — manage_pdf_presets gate (#486)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await POST(postRequest(VALID_POST_BODY), noParams);

    expect(res.status).toBe(401);
    expect(createPreset).not.toHaveBeenCalled();
  });

  it("returns 403 for an edit-only user who lacks manage_pdf_presets", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["edit_estimates"],
        }),
      }) as never,
    );

    const res = await POST(postRequest(VALID_POST_BODY), noParams);

    expect(res.status).toBe(403);
    expect(createPreset).not.toHaveBeenCalled();
  });

  it("creates the preset for a non-admin holding manage_pdf_presets", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_member",
          grants: ["manage_pdf_presets"],
        }),
      }) as never,
    );
    vi.mocked(createPreset).mockResolvedValue({ id: "preset-9" } as PdfPreset);

    const res = await POST(postRequest(VALID_POST_BODY), noParams);

    expect(res.status).toBe(201);
    expect(createPreset).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ preset: { id: "preset-9" } });
  });

  it("allows an admin who holds no explicit grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );
    vi.mocked(createPreset).mockResolvedValue({ id: "preset-admin" } as PdfPreset);

    const res = await POST(postRequest(VALID_POST_BODY), noParams);

    expect(res.status).toBe(201);
    expect(createPreset).toHaveBeenCalledTimes(1);
  });
});
