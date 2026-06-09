// PUT /api/pdf-presets/[id] — runtime validation for the #576 toggles.
// show_overhead/show_profit are boolean-validated like every other switch in
// BOOL_FIELDS: a non-boolean value is a 400, not a pass-through to Postgres.
//
// Mirrors the sibling route.test.ts pattern: mock the server client +
// active-org resolver + the pdf-presets lib, drive the exported handler.

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
  getPreset: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
}));

import { PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { updatePreset } from "@/lib/pdf-presets";
import {
  fakeUserClient,
  memberTables,
} from "../../email/__test-utils__/request-context-fakes";
import type { PdfPreset } from "@/lib/types";

const routeCtx = { params: Promise.resolve({ id: "preset-1" }) };

function putRequest(body: unknown): Request {
  return new Request("http://test/api/pdf-presets/preset-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function useAdmin() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PUT /api/pdf-presets/[id] — show_overhead/show_profit (#576)", () => {
  it("rejects a non-boolean show_overhead with 400 without writing", async () => {
    useAdmin();

    const res = await PUT(putRequest({ show_overhead: "yes" }), routeCtx);

    expect(res.status).toBe(400);
    expect(updatePreset).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean show_profit with 400 without writing", async () => {
    useAdmin();

    const res = await PUT(putRequest({ show_profit: 1 }), routeCtx);

    expect(res.status).toBe(400);
    expect(updatePreset).not.toHaveBeenCalled();
  });

  it("forwards boolean show_overhead/show_profit to updatePreset", async () => {
    useAdmin();
    vi.mocked(updatePreset).mockResolvedValue({ id: "preset-1" } as PdfPreset);

    const res = await PUT(
      putRequest({ show_overhead: true, show_profit: false }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    expect(updatePreset).toHaveBeenCalledWith(
      expect.anything(),
      "preset-1",
      expect.objectContaining({ show_overhead: true, show_profit: false }),
    );
  });
});
