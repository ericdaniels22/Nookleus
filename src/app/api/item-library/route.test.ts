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
  listItems: vi.fn(),
  createItem: vi.fn(),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listItems, createItem } from "@/lib/item-library";
import {
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

const noParams = { params: Promise.resolve({}) };

function getRequest() {
  return new Request("http://test/api/item-library");
}
function postRequest(body: unknown) {
  return new Request("http://test/api/item-library", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validCreate = {
  name: "2x4 Lumber",
  description: "Framing lumber",
  category: "materials",
  default_quantity: 1,
  unit_price: 4.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/item-library (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated and never lists items", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await GET(getRequest(), noParams);
    expect(res.status).toBe(401);
    expect(listItems).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller holds neither view_estimates nor view_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: [] }) as never,
    );
    const res = await GET(getRequest(), noParams);
    expect(res.status).toBe(403);
    expect(listItems).not.toHaveBeenCalled();
  });

  it("allows a caller holding only view_invoices (any-of multi-key rule)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_invoices"] }) as never,
    );
    vi.mocked(listItems).mockResolvedValue([{ id: "i-1" }] as never);
    const res = await GET(getRequest(), noParams);
    expect(res.status).toBe(200);
    expect(listItems).toHaveBeenCalledOnce();
  });

  it("allows a caller holding only view_estimates (the other any-of key)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_estimates"] }) as never,
    );
    vi.mocked(listItems).mockResolvedValue([] as never);
    const res = await GET(getRequest(), noParams);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/item-library (converted to withRequestContext)", () => {
  it("returns 403 when the caller lacks manage_item_library", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["view_invoices"] }) as never,
    );
    const res = await POST(postRequest(validCreate), noParams);
    expect(res.status).toBe(403);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid body for an authorized caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "admin" }) as never,
    );
    const res = await POST(postRequest({ ...validCreate, name: "" }), noParams);
    expect(res.status).toBe(400);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("creates the item, passing the caller's id and active org to createItem", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("u1", { role: "member", grants: ["manage_item_library"] }) as never,
    );
    vi.mocked(createItem).mockResolvedValue({ id: "i-9" } as never);
    const res = await POST(postRequest(validCreate), noParams);
    expect(res.status).toBe(201);
    expect(createItem).toHaveBeenCalledOnce();
    const [, orgId, userId] = vi.mocked(createItem).mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(userId).toBe("u1");
  });
});
