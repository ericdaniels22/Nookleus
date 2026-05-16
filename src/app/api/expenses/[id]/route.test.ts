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

import { DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function callerIs(role: string, grants: string[] = []) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role, grants }),
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("DELETE /api/expenses/[id] (converted to withRequestContext)", () => {
  it("returns 403 when a non-admin lacks the log_expenses permission", async () => {
    callerIs("member", []);
    const service = fakeServiceClient({});
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(403);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("returns 404 when the expense is not in the caller's active organization", async () => {
    callerIs("admin");
    const service = fakeServiceClient({
      tables: {
        expenses: [
          { id: "exp-1", organization_id: "other-org", submitted_by: "user-1" },
        ],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(404);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("returns 403 when a non-admin tries to delete an expense they did not submit", async () => {
    callerIs("member", ["log_expenses"]);
    const service = fakeServiceClient({
      tables: {
        expenses: [
          {
            id: "exp-1",
            organization_id: "org-1",
            submitted_by: "someone-else",
            receipt_path: null,
            thumbnail_path: null,
            activity_id: null,
          },
        ],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(403);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("deletes an expense the caller submitted and cleans up its storage objects", async () => {
    callerIs("member", ["log_expenses"]);
    const service = fakeServiceClient({
      tables: {
        expenses: [
          {
            id: "exp-1",
            organization_id: "org-1",
            submitted_by: "user-1",
            receipt_path: "org-1/receipts/exp-1.jpg",
            thumbnail_path: "org-1/thumbs/exp-1.jpg",
            activity_id: "act-1",
          },
        ],
      },
      rpcResults: {
        delete_expense_cascade: {
          data: {
            receipt_path: "org-1/receipts/exp-1.jpg",
            thumbnail_path: "org-1/thumbs/exp-1.jpg",
          },
        },
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(service.rpcCalls).toEqual([
      { name: "delete_expense_cascade", args: { p_expense_id: "exp-1" } },
    ]);
    expect(service.storageRemovals).toEqual([
      {
        bucket: "receipts",
        paths: ["org-1/receipts/exp-1.jpg", "org-1/thumbs/exp-1.jpg"],
      },
    ]);
  });

  it("lets an admin delete an expense submitted by another user", async () => {
    callerIs("admin");
    const service = fakeServiceClient({
      tables: {
        expenses: [
          {
            id: "exp-1",
            organization_id: "org-1",
            submitted_by: "someone-else",
            receipt_path: null,
            thumbnail_path: null,
            activity_id: null,
          },
        ],
      },
      rpcResults: { delete_expense_cascade: { data: {} } },
    });
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);

    const res = await DELETE(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(200);
    expect(service.rpcCalls).toHaveLength(1);
  });
});
