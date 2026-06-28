// load-org-timezone — the server-side path (#704, ADR 0020) that resolves an
// Organization id to its effective IANA zone. The two things that matter here
// are I/O concerns the pure resolver can't cover: it scopes the read to ONE
// organization id (cross-org isolation), and it surfaces a query error rather
// than silently defaulting. The precedence itself is covered in
// `org-timezone.test.ts`.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOrganizationTimezone } from "./load-org-timezone";

// A fake `company_settings` table keyed by organization_id. The builder records
// the org id the caller scoped to and returns only that org's rows, so a query
// for A can never see B's `timezone`/`address_state`.
function fakeSupabase(
  rowsByOrg: Record<string, Array<{ key: string; value: string | null }>>,
  onSelect?: (orgId: string) => void,
) {
  return {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (_col: string, orgId: string) => {
        onSelect?.(orgId);
        builder.then = (resolve: (r: unknown) => void) =>
          resolve({ data: rowsByOrg[orgId] ?? [], error: null });
        return builder;
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("loadOrganizationTimezone", () => {
  const rows = {
    "org-a": [
      { key: "timezone", value: "America/New_York" },
      { key: "address_state", value: "TX" },
    ],
    "org-b": [{ key: "address_state", value: "CA" }],
  };

  it("resolves only the requested Organization's rows (cross-org isolation)", async () => {
    const seen: string[] = [];
    const supabase = fakeSupabase(rows, (orgId) => seen.push(orgId));

    const a = await loadOrganizationTimezone(supabase, "org-a");
    const b = await loadOrganizationTimezone(supabase, "org-b");

    // A reads A's stored zone; B reads B's address-derived default. Neither
    // request scoped to the other's id, and neither saw the other's value.
    expect(a).toBe("America/New_York");
    expect(b).toBe("America/Los_Angeles");
    expect(seen).toEqual(["org-a", "org-b"]);
  });

  it("resolves an Organization with no settings rows to the UTC fallback", async () => {
    const supabase = fakeSupabase({});
    expect(await loadOrganizationTimezone(supabase, "org-empty")).toBe("UTC");
  });

  it("throws on a query error rather than silently defaulting", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            then: (resolve: (r: unknown) => void) =>
              resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      loadOrganizationTimezone(supabase, "org-x"),
    ).rejects.toThrow("boom");
  });
});
