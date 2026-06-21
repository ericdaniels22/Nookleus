// Issue #704 — the Organization timezone is stored as a `timezone` key in the
// existing `company_settings` table and rides the existing
// `/api/settings/company` GET/PUT endpoint with no schema migration and no new
// permission. These characterization tests pin the two endpoint guarantees the
// issue calls out:
//
//   AC7 — editing stays gated by `access_settings`: a caller lacking it is
//         denied the timezone endpoint (no new permission key was introduced).
//   AC6 — cross-org isolation: a request in one Organization reads and writes
//         only its own `timezone` key, never another Organization's.
//
// No route code changes for #704 — the route already accepts arbitrary keys,
// gates on `access_settings`, and scopes every read/write to the active org.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authedWith(client: ReturnType<typeof fakeUserClient>) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
}

function putTimezone(tz: string) {
  return new Request("http://test", {
    method: "PUT",
    body: JSON.stringify({ timezone: tz }),
  });
}

const lacksSettings = () => ({
  user: { id: "u" },
  tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
});
const ownsSettings = () => ({
  user: { id: "u" },
  tables: memberTables({
    userId: "u",
    role: "crew_member",
    grants: ["access_settings"],
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("Organization timezone endpoint — gated on access_settings (#704 AC7)", () => {
  it("denies viewing the timezone without access_settings", async () => {
    authedWith(fakeUserClient(lacksSettings()));
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });

  it("denies saving the timezone without access_settings", async () => {
    authedWith(fakeUserClient(lacksSettings()));
    expect((await PUT(putTimezone("America/New_York"), noParams)).status).toBe(
      403,
    );
  });

  it("lets an owner holding access_settings save the timezone", async () => {
    authedWith(fakeUserClient(ownsSettings()));
    expect((await PUT(putTimezone("America/New_York"), noParams)).status).toBe(
      200,
    );
  });
});

describe("Organization timezone endpoint — cross-org isolation (#704 AC6)", () => {
  it("writes the timezone scoped to the active organization only", async () => {
    const client = fakeUserClient(ownsSettings());
    authedWith(client);

    await PUT(putTimezone("America/New_York"), noParams);

    const upsert = client.__mutations.find(
      (m) => m.table === "company_settings" && m.op === "upsert",
    );
    expect(upsert).toBeDefined();
    const payload = upsert!.payload as Record<string, unknown>;
    expect(payload.key).toBe("timezone");
    expect(payload.value).toBe("America/New_York");
    // The write is bound to the active org — never a hardcoded or foreign org.
    expect(payload.organization_id).toBe("org-1");
  });

  it("reads only the active organization's timezone, never another org's", async () => {
    // Seed both orgs' timezone rows; the active org is org-1.
    authedWith(
      fakeUserClient({
        user: { id: "u" },
        tables: memberTables({
          userId: "u",
          role: "crew_member",
          grants: ["access_settings"],
          extraTables: {
            company_settings: [
              {
                organization_id: "org-1",
                key: "timezone",
                value: "America/New_York",
              },
              {
                organization_id: "org-2",
                key: "timezone",
                value: "America/Los_Angeles",
              },
            ],
          },
        }),
      }),
    );

    const res = await GET(new Request("http://test"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timezone).toBe("America/New_York");
    // org-2's zone must never leak into org-1's response.
    expect(JSON.stringify(body)).not.toContain("America/Los_Angeles");
  });
});
