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

import { withRequestContext, type RequestContext } from "./with-request-context";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// A fake User client covering exactly the surface the wrapper touches:
// auth.getUser, the `user_organizations` membership lookup (maybeSingle),
// and the `user_organization_permissions` grants lookup (awaited list).
function fakeUserClient(opts: {
  user: { id: string } | null;
  membership?: { id: string; role: string } | null;
  grants?: string[];
}) {
  const membership = opts.membership ?? null;
  const grants = opts.grants ?? [];
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.user }, error: null };
      },
    },
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: membership, error: null };
        },
        then(
          resolve: (v: {
            data: { permission_key: string }[];
            error: null;
          }) => unknown,
        ) {
          return resolve({
            data: grants.map((permission_key) => ({ permission_key })),
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

const SERVICE_SENTINEL = { __service: true };

function paramsContext<T>(params: T) {
  return { params: Promise.resolve(params) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceClient).mockReturnValue(SERVICE_SENTINEL as never);
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("withRequestContext", () => {
  it("returns 401 and never invokes the handler when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const handler = vi.fn();

    const route = withRequestContext({ permission: "log_expenses" }, handler);
    const res = await route(new Request("http://test"), paramsContext({}));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 and never invokes the handler when the rule is not satisfied", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "member" },
        grants: ["view_invoices"],
      }) as never,
    );
    const handler = vi.fn();

    const route = withRequestContext({ permission: "log_expenses" }, handler);
    const res = await route(new Request("http://test"), paramsContext({}));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Permission denied" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when an authenticated caller has no membership in the active organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" }, membership: null }) as never,
    );
    const handler = vi.fn();

    const route = withRequestContext({ adminOnly: true }, handler);
    const res = await route(new Request("http://test"), paramsContext({}));

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes the handler with a Request Context carrying userId, orgId and role", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "member" },
        grants: ["log_expenses"],
      }) as never,
    );
    let received: RequestContext | undefined;
    const handler = vi.fn((_req: Request, ctx: RequestContext) => {
      received = ctx;
      return new Response("ok");
    });

    const route = withRequestContext({ permission: "log_expenses" }, handler);
    const res = await route(new Request("http://test"), paramsContext({}));

    expect(res.status).toBe(200);
    expect(received?.userId).toBe("user-1");
    expect(received?.orgId).toBe("org-1");
    expect(received?.role).toBe("member");
  });

  // Handlers that delegate to an access-decision module (#139, PRD #134) need
  // the caller's permission grants without re-fetching them. The wrapper
  // already resolved them; carry them through on the Request Context.
  it("carries the caller's granted permission keys through on the context", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "crew_lead" },
        grants: ["view_email", "send_email"],
      }) as never,
    );
    let received: RequestContext | undefined;
    const handler = vi.fn((_req: Request, ctx: RequestContext) => {
      received = ctx;
      return new Response("ok");
    });

    const route = withRequestContext({ permission: "view_email" }, handler);
    await route(new Request("http://test"), paramsContext({}));

    expect(received?.grantedPermissions).toEqual(["view_email", "send_email"]);
  });

  it("admits an admin against a permission rule they hold no grant for", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "admin-1" },
        membership: { id: "m-1", role: "admin" },
        grants: [],
      }) as never,
    );
    const handler = vi.fn(() => new Response("ok"));

    const route = withRequestContext({ permission: "log_expenses" }, handler);
    const res = await route(new Request("http://test"), paramsContext({}));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("omits the Service client from the context unless the rule opts in", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "admin" },
      }) as never,
    );
    let received: RequestContext | undefined;
    const handler = vi.fn((_req: Request, ctx: RequestContext) => {
      received = ctx;
      return new Response("ok");
    });

    const route = withRequestContext({}, handler);
    await route(new Request("http://test"), paramsContext({}));

    expect(received?.serviceClient).toBeUndefined();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("includes the Service client when the rule sets serviceClient: true", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "admin" },
      }) as never,
    );
    let received: RequestContext | undefined;
    const handler = vi.fn((_req: Request, ctx: RequestContext) => {
      received = ctx;
      return new Response("ok");
    });

    const route = withRequestContext({ serviceClient: true }, handler);
    await route(new Request("http://test"), paramsContext({}));

    expect(received?.serviceClient).toBe(SERVICE_SENTINEL);
  });

  it("passes the Next.js route segment context through to the handler untouched", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        membership: { id: "m-1", role: "admin" },
      }) as never,
    );
    let receivedParams: unknown;
    const handler = vi.fn(
      async (
        _req: Request,
        _ctx: RequestContext,
        routeContext: { params: Promise<{ id: string }> },
      ) => {
        receivedParams = await routeContext.params;
        return new Response("ok");
      },
    );

    const route = withRequestContext<{ id: string }>({}, handler);
    await route(new Request("http://test"), paramsContext({ id: "exp-9" }));

    expect(receivedParams).toEqual({ id: "exp-9" });
  });
});
