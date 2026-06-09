import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// The route body calls the create_estimate_with_template RPC, which the
// shared fakes don't model — spread an `rpc` mock onto the fake User client.
type RpcResult = { data: string | null; error: { message: string } | null };

function useUser(
  opts: Parameters<typeof fakeUserClient>[0],
  rpc = vi.fn(async (): Promise<RpcResult> => ({ data: "est-1", error: null })),
) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    ...fakeUserClient(opts),
    rpc,
  } as never);
  return rpc;
}

function postRequest(body: unknown) {
  return new Request("http://test/api/estimates/create-with-template", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/estimates/create-with-template", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await POST(postRequest({}), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks create_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await POST(postRequest({}), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });

  it("reaches the handler when the caller holds create_estimates", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["create_estimates"],
      }),
    });
    // Missing job_id — the handler's own validation answers 400, which only
    // happens once the gate has passed.
    const res = await POST(postRequest({}), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "job_id required" });
  });

  it("an admin passes the gate without holding the key", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
    });
    const res = await POST(postRequest({}), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it("calls the create_estimate_with_template RPC and returns the new id", async () => {
    const rpc = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["create_estimates"],
      }),
    });

    const res = await POST(
      postRequest({
        job_id: "job-42",
        title: "Roof Replacement",
        template_id: "t-water",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "est-1" });
    expect(rpc).toHaveBeenCalledWith("create_estimate_with_template", {
      p_job_id: "job-42",
      p_title: "Roof Replacement",
      p_template_id: "t-water",
    });
  });

  it("passes nulls through when title and template are omitted", async () => {
    const rpc = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["create_estimates"],
      }),
    });

    const res = await POST(postRequest({ job_id: "job-42" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_estimate_with_template", {
      p_job_id: "job-42",
      p_title: null,
      p_template_id: null,
    });
  });

  it.each([
    ["job_not_found", 404],
    ["template_not_found_or_inactive", 404],
  ])("maps the RPC's %s to a %i with the token as error", async (token, status) => {
    useUser(
      {
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["create_estimates"],
        }),
      },
      vi.fn(async (): Promise<RpcResult> => ({
        data: null,
        error: { message: token },
      })),
    );

    const res = await POST(postRequest({ job_id: "job-42" }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: token });
  });
});
