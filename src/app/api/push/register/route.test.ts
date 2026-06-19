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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
} from "../../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function req(body: unknown): Request {
  return new Request("http://test/api/push/register", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// The route stores/refreshes the CALLER's device address. Like the
// notifications route (#119), it derives the owner from the authenticated
// caller (`ctx.userId`) and writes with the Service client — it never trusts a
// client-supplied user id.

describe("POST /api/push/register — happy path", () => {
  it("registers the caller's token and returns ok", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    const service = fakeServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(req({ token: "apns-tok-1" }), noParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const upsert = service.__mutations.find((m) => m.op === "upsert");
    expect(upsert?.table).toBe("device_tokens");
    expect(upsert?.payload).toMatchObject({
      user_id: "user-1",
      organization_id: "org-1",
      token: "apns-tok-1",
      platform: "ios",
    });
  });
});

describe("POST /api/push/register — auth + validation", () => {
  it("returns 401 when unauthenticated and writes nothing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const service = fakeServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(req({ token: "apns-tok-1" }), noParams);

    expect(res.status).toBe(401);
    expect(service.__mutations).toHaveLength(0);
  });

  it("returns 400 when the token is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    const service = fakeServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(req({}), noParams);

    expect(res.status).toBe(400);
    expect(service.__mutations).toHaveLength(0);
  });

  it("returns 400 for a non-iOS platform", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    const service = fakeServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(
      req({ token: "apns-tok-1", platform: "android" }),
      noParams,
    );

    expect(res.status).toBe(400);
    expect(service.__mutations).toHaveLength(0);
  });

  it("does not trust a client-supplied user_id — it registers the caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    const service = fakeServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(
      req({ token: "apns-tok-1", user_id: "user-2", userId: "user-2" }),
      noParams,
    );

    expect(res.status).toBe(200);
    const upsert = service.__mutations.find((m) => m.op === "upsert");
    expect(upsert?.payload).toMatchObject({ user_id: "user-1" });
  });
});
