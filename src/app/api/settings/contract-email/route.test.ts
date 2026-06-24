import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

// Like authed(), but hands back the client so a test can inspect the
// `__mutations` it recorded (the PATCH payload that reached `.update()`).
function authedClient(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client as ReturnType<typeof fakeUserClient> & {
    __mutations: { table: string; op: string; payload?: Record<string, unknown> }[];
  };
}

function patchBody(body: Record<string, unknown>) {
  return new Request("http://test", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function patchReq() {
  return new Request("http://test", { method: "PATCH", body: "{}" });
}

// The contract_email_settings table is a seeded singleton; route bodies error
// if it is missing, so the holder/admin cases seed one row.
const settingsRow = { contract_email_settings: [{ id: "ce-1", provider: "resend" }] };

const lacks = () => ({
  user: { id: "u" },
  tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
});
const holds = () => ({
  user: { id: "u" },
  tables: memberTables({
    userId: "u",
    role: "crew_member",
    grants: ["access_settings"],
    extraTables: settingsRow,
  }),
});
const admin = () => ({
  user: { id: "a" },
  tables: memberTables({
    userId: "a",
    role: "admin",
    grants: [],
    extraTables: settingsRow,
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/settings/contract-email — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });

  it("returns settings when the caller holds access_settings", async () => {
    authed(holds());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
});

describe("PATCH /api/settings/contract-email — gated on access_settings (#107)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    expect((await PATCH(patchReq(), noParams)).status).toBe(401);
  });

  it("returns 403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PATCH(patchReq(), noParams)).status).toBe(403);
  });

  it("updates settings when the caller holds access_settings", async () => {
    authed(holds());
    expect((await PATCH(patchReq(), noParams)).status).toBe(200);
  });

  it("admins retain access without holding the key", async () => {
    authed(admin());
    expect((await PATCH(patchReq(), noParams)).status).toBe(200);
  });
});

describe("PATCH /api/settings/contract-email — branded-card style knobs (#691)", () => {
  it("rejects an invalid button color with 400", async () => {
    authed(holds());
    const res = await PATCH(patchBody({ button_color: "red" }), noParams);
    expect(res.status).toBe(400);
  });

  it("persists a valid hex button color", async () => {
    const client = authedClient(holds());
    const res = await PATCH(patchBody({ button_color: "#dc2626" }), noParams);
    expect(res.status).toBe(200);
    const update = client.__mutations.find((m) => m.op === "update");
    expect(update?.payload).toMatchObject({ button_color: "#dc2626" });
  });

  it("persists the logo-visible toggle", async () => {
    const client = authedClient(holds());
    const res = await PATCH(patchBody({ logo_visible: false }), noParams);
    expect(res.status).toBe(200);
    const update = client.__mutations.find((m) => m.op === "update");
    expect(update?.payload).toMatchObject({ logo_visible: false });
  });

  it("persists the button label", async () => {
    const client = authedClient(holds());
    const res = await PATCH(patchBody({ button_label: "Open & sign" }), noParams);
    expect(res.status).toBe(200);
    const update = client.__mutations.find((m) => m.op === "update");
    expect(update?.payload).toMatchObject({ button_label: "Open & sign" });
  });

  it("never lets a client overwrite the archived body template", async () => {
    const client = authedClient(holds());
    await PATCH(
      patchBody({ signing_request_body_template_archived: "hacked" }),
      noParams,
    );
    const update = client.__mutations.find((m) => m.op === "update");
    expect(update?.payload).not.toHaveProperty(
      "signing_request_body_template_archived",
    );
  });
});

describe("GET /api/settings/contract-email — branded-card style knobs (#691)", () => {
  it("returns the new style fields", async () => {
    authed({
      user: { id: "u" },
      tables: memberTables({
        userId: "u",
        role: "crew_member",
        grants: ["access_settings"],
        extraTables: {
          contract_email_settings: [
            {
              id: "ce-1",
              provider: "resend",
              button_label: "Review & sign",
              button_color: "#1f2937",
              logo_visible: true,
            },
          ],
        },
      }),
    });
    const res = await GET(new Request("http://test"), noParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.button_color).toBe("#1f2937");
    expect(json.button_label).toBe("Review & sign");
    expect(json.logo_visible).toBe(true);
  });
});
