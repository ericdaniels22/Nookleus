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
vi.mock("@/lib/item-library", () => ({
  getItem: vi.fn(),
  updateItem: vi.fn(),
  deactivateItem: vi.fn(),
}));

import { GET, PUT, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getItem, updateItem, deactivateItem } from "@/lib/item-library";
import {
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function makeRequest(method: string, body?: unknown) {
  return new Request("http://test/api/item-library/i-1", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/item-library/[id] (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await GET(makeRequest("GET"), paramsFor("i-1"));
    expect(res.status).toBe(401);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller holds neither view permission", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: [] }) as never,
    );
    const res = await GET(makeRequest("GET"), paramsFor("i-1"));
    expect(res.status).toBe(403);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("returns the item for a caller holding view_invoices (any-of rule)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_invoices"] }) as never,
    );
    vi.mocked(getItem).mockResolvedValue({ id: "i-1" } as never);
    const res = await GET(makeRequest("GET"), paramsFor("i-1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the item does not exist", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_estimates"] }) as never,
    );
    vi.mocked(getItem).mockResolvedValue(null as never);
    const res = await GET(makeRequest("GET"), paramsFor("i-1"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/item-library/[id] (converted to withRequestContext)", () => {
  it("returns 403 when the caller lacks manage_item_library", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_invoices"] }) as never,
    );
    const res = await PUT(makeRequest("PUT", { name: "Renamed" }), paramsFor("i-1"));
    expect(res.status).toBe(403);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("updates the item for an authorized caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "admin" }) as never,
    );
    vi.mocked(getItem).mockResolvedValue({ id: "i-1", is_active: true } as never);
    vi.mocked(updateItem).mockResolvedValue({ id: "i-1", name: "Renamed" } as never);
    const res = await PUT(makeRequest("PUT", { name: "Renamed" }), paramsFor("i-1"));
    expect(res.status).toBe(200);
    expect(updateItem).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/item-library/[id] (converted to withRequestContext)", () => {
  it("returns 403 when the caller lacks manage_item_library", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_estimates"] }) as never,
    );
    const res = await DELETE(makeRequest("DELETE"), paramsFor("i-1"));
    expect(res.status).toBe(403);
    expect(deactivateItem).not.toHaveBeenCalled();
  });

  it("deactivates the item for an authorized caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["manage_item_library"] }) as never,
    );
    vi.mocked(getItem).mockResolvedValue({ id: "i-1", is_active: true } as never);
    vi.mocked(deactivateItem).mockResolvedValue(undefined as never);
    const res = await DELETE(makeRequest("DELETE"), paramsFor("i-1"));
    expect(res.status).toBe(200);
    expect(deactivateItem).toHaveBeenCalledOnce();
  });
});
