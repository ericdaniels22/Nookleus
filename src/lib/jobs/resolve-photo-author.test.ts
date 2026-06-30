import { describe, it, expect, vi } from "vitest";
import { resolvePhotoAuthor } from "./resolve-photo-author";

type Supa = Parameters<typeof resolvePhotoAuthor>[0];

/**
 * A structural Supabase fake exposing only what resolvePhotoAuthor touches:
 * `auth.getUser()` and a `user_profiles` select-by-id that resolves through
 * `.maybeSingle()`. The real client is assignable, so the call site stays
 * typechecked; this fake satisfies the param via the same cast house style as
 * persist-annotated-render's test.
 */
function makeClient({
  user,
  profile,
}: {
  user: { id: string; email?: string | null } | null;
  profile?: { full_name?: string | null } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile ?? null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi.fn().mockResolvedValue({ data: { user } });
  const client = { auth: { getUser }, from } as unknown as Supa;
  return { client, getUser, from, select, eq, maybeSingle };
}

describe("resolvePhotoAuthor", () => {
  it("attributes the signed-in user's profile full name", async () => {
    const { client } = makeClient({
      user: { id: "u1", email: "eric@aaacontracting.com" },
      profile: { full_name: "Eric Daniels" },
    });
    expect(await resolvePhotoAuthor(client)).toBe("Eric Daniels");
  });

  it("falls back to the account email when the profile has no full name", async () => {
    const { client } = makeClient({
      user: { id: "u1", email: "eric@aaacontracting.com" },
      profile: { full_name: null },
    });
    expect(await resolvePhotoAuthor(client)).toBe("eric@aaacontracting.com");
  });

  it("returns \"unknown\" when there is no signed-in user", async () => {
    const { client, from } = makeClient({ user: null });
    expect(await resolvePhotoAuthor(client)).toBe("unknown");
    // No user id to scope by, so the profile lookup is skipped entirely.
    expect(from).not.toHaveBeenCalled();
  });
});
