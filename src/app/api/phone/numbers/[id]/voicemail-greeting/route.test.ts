// @vitest-environment node
// PRD #304 — Nookleus Phone. Slice 13 (#317) — set/clear a number's
// voicemail greeting.
//
//   PUT    /api/phone/numbers/[id]/voicemail-greeting  (multipart `file`)
//   DELETE /api/phone/numbers/[id]/voicemail-greeting
//
// A greeting applies to BOTH kinds (unlike the inbound_rule PATCH, which is
// Shared-only): a Personal number's owner records their own greeting, an admin
// records the greeting on a Shared number. The gate is canManage — Shared →
// admin; Personal → owner-self (or admin). The audio is validated (mp3/wav
// only, Twilio <Play> compatible) and stored in the private greetings bucket;
// the column holds the storage PATH, signed fresh at call time by the webhook.
//
// Runs the REAL withRequestContext (mocking only the Supabase factories +
// active-org). The Service client is a combined recorder: DB builder for the
// row lookup/update AND a storage surface for the bucket upload/remove.

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

import { PUT, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

// Combined Service-client recorder: `.from(table)` is the DB builder (records
// updates), `.storage.from(bucket)` is the bucket surface (records uploads +
// removes). The greeting route reads/writes the row through the former and
// uploads/clears the audio through the latter.
function makeService(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { phone_numbers: [], ...seed };
  const updates: { table: string; patch: Row; filters: Row }[] = [];
  const uploads: Array<{ bucket: string; path: string; upsert?: boolean }> = [];
  const removed: Array<{ bucket: string; paths: string[] }> = [];

  function builder(table: string) {
    let rows = tables[table] ?? [];
    const ctx: { filters: Row } = { filters: {} };
    let pendingUpdate: Row | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.single = async () => {
      if (pendingUpdate) {
        updates.push({ table, patch: pendingUpdate, filters: { ...ctx.filters } });
        return { data: { ...(rows[0] ?? {}), ...pendingUpdate }, error: null };
      }
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "no rows" },
      };
    };
    return b;
  }

  return {
    updates,
    uploads,
    removed,
    client: {
      from: builder,
      storage: {
        from(bucket: string) {
          return {
            async upload(
              path: string,
              _body: unknown,
              options?: { upsert?: boolean },
            ) {
              uploads.push({ bucket, path, upsert: options?.upsert });
              return { data: { path }, error: null };
            },
            async remove(paths: string[]) {
              removed.push({ bucket, paths });
              return { data: [], error: null };
            },
            async createSignedUrl(path: string) {
              return {
                data: { signedUrl: `https://signed/${bucket}/${path}` },
                error: null,
              };
            },
          };
        },
      },
    },
  };
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function wavFile(size = 2048): File {
  return new File([new Uint8Array(size).fill(1)], "greeting.wav", {
    type: "audio/wav",
  });
}

function putReq(file?: File): Request {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://test/api/phone/numbers/pn-1/voicemail-greeting", {
    method: "PUT",
    body: form,
  });
}

function deleteReq(): Request {
  return new Request("http://test/api/phone/numbers/pn-1/voicemail-greeting", {
    method: "DELETE",
  });
}

const PERSONAL_ROW = {
  id: "pn-1",
  organization_id: "org-1",
  kind: "personal" as const,
  user_id: "user-1",
  voicemail_greeting_url: null,
};

const SHARED_ROW = {
  id: "pn-2",
  organization_id: "org-1",
  kind: "shared" as const,
  user_id: null,
  voicemail_greeting_url: null,
};

// Authenticate a crew_lead with view_phone (the self-service caller).
function asOwner() {
  authed({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "crew_lead",
      grants: ["view_phone"],
    }),
  });
}

// A different member of the same org — has view_phone, but does NOT own pn-1.
function asOtherMember() {
  authed({
    user: { id: "user-2" },
    tables: memberTables({
      userId: "user-2",
      role: "crew_lead",
      grants: ["view_phone"],
    }),
  });
}

function asAdmin() {
  authed({
    user: { id: "admin-1" },
    tables: memberTables({
      userId: "admin-1",
      role: "admin",
      grants: ["view_phone"],
    }),
  });
}

function webmFile(size = 2048): File {
  return new File([new Uint8Array(size).fill(1)], "greeting.webm", {
    type: "audio/webm",
  });
}

function seedService(rows: Row[]) {
  const svc = makeService({ phone_numbers: rows });
  vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PUT /api/phone/numbers/[id]/voicemail-greeting — set (tracer)", () => {
  it("owner uploads a WAV: stored in the greetings bucket, path persisted to the column", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });
    const svc = makeService({ phone_numbers: [PERSONAL_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(200);
    // Uploaded to the greetings bucket at the deterministic per-number path.
    expect(svc.uploads).toHaveLength(1);
    expect(svc.uploads[0].bucket).toBe("phone-voicemail-greetings");
    expect(svc.uploads[0].path).toBe("org-1/pn-1.wav");
    // The column stores the storage path (not a URL).
    const upd = svc.updates.find((u) => u.table === "phone_numbers");
    expect(upd).toBeDefined();
    expect(upd!.filters).toMatchObject({ id: "pn-1" });
    expect(upd!.patch.voicemail_greeting_url).toBe("org-1/pn-1.wav");
    const json = await res.json();
    expect(json.voicemail_greeting_url).toBe("org-1/pn-1.wav");
  });
});

describe("PUT /api/phone/numbers/[id]/voicemail-greeting — manage gate", () => {
  it("401s an unauthenticated caller before touching storage", async () => {
    authed({ user: null });
    const svc = seedService([PERSONAL_ROW]);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(401);
    expect(svc.uploads).toHaveLength(0);
    expect(svc.updates).toHaveLength(0);
  });

  it("403s a member who does not own the Personal number — and never uploads", async () => {
    asOtherMember();
    const svc = seedService([PERSONAL_ROW]);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(403);
    // The privacy invariant: a non-owner cannot even write a greeting onto
    // someone else's Personal number, so nothing reaches the bucket.
    expect(svc.uploads).toHaveLength(0);
    expect(svc.updates).toHaveLength(0);
  });

  it("403s a non-admin on a Shared number — Shared is admin-managed", async () => {
    asOwner(); // crew_lead user-1, view_phone, but not admin
    const svc = seedService([SHARED_ROW]);

    const res = await PUT(putReq(wavFile()), idParams("pn-2"));

    expect(res.status).toBe(403);
    expect(svc.uploads).toHaveLength(0);
  });

  it("lets an admin set the greeting on a Shared number", async () => {
    asAdmin();
    const svc = seedService([SHARED_ROW]);

    const res = await PUT(putReq(wavFile()), idParams("pn-2"));

    expect(res.status).toBe(200);
    expect(svc.uploads[0].path).toBe("org-1/pn-2.wav");
    const upd = svc.updates.find((u) => u.table === "phone_numbers");
    expect(upd!.patch.voicemail_greeting_url).toBe("org-1/pn-2.wav");
  });

  it("404s a number that does not exist", async () => {
    asOwner();
    const svc = seedService([]); // no rows

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(404);
    expect(svc.uploads).toHaveLength(0);
  });

  it("404s a number in another org — a cross-org caller cannot prove it exists", async () => {
    asOwner();
    const svc = seedService([{ ...PERSONAL_ROW, organization_id: "org-2" }]);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(404);
    expect(svc.uploads).toHaveLength(0);
  });
});

describe("PUT /api/phone/numbers/[id]/voicemail-greeting — validation", () => {
  it("400s when no file is attached", async () => {
    asOwner();
    const svc = seedService([PERSONAL_ROW]);

    const res = await PUT(putReq(), idParams("pn-1"));

    expect(res.status).toBe(400);
    expect(svc.uploads).toHaveLength(0);
  });

  it("400s a non-<Play>-compatible format (webm) without uploading", async () => {
    asOwner();
    const svc = seedService([PERSONAL_ROW]);

    const res = await PUT(putReq(webmFile()), idParams("pn-1"));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/MP3 or WAV/i);
    expect(svc.uploads).toHaveLength(0);
  });
});

describe("PUT /api/phone/numbers/[id]/voicemail-greeting — re-record cleanup", () => {
  it("removes the previous object when the new greeting lands at a different extension", async () => {
    asOwner();
    // Existing greeting was an mp3; the new upload is a wav → different path.
    const svc = seedService([
      { ...PERSONAL_ROW, voicemail_greeting_url: "org-1/pn-1.mp3" },
    ]);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(200);
    expect(svc.uploads[0].path).toBe("org-1/pn-1.wav");
    // The orphaned mp3 is cleaned up best-effort.
    expect(svc.removed).toEqual([
      { bucket: "phone-voicemail-greetings", paths: ["org-1/pn-1.mp3"] },
    ]);
  });

  it("does not remove anything when re-recording at the same extension (upsert overwrites in place)", async () => {
    asOwner();
    const svc = seedService([
      { ...PERSONAL_ROW, voicemail_greeting_url: "org-1/pn-1.wav" },
    ]);

    const res = await PUT(putReq(wavFile()), idParams("pn-1"));

    expect(res.status).toBe(200);
    // Same path → upload upserts over it, no stale object to remove.
    expect(svc.removed).toHaveLength(0);
  });
});

describe("DELETE /api/phone/numbers/[id]/voicemail-greeting — clear", () => {
  it("owner clears: removes the object and nulls the column", async () => {
    asOwner();
    const svc = seedService([
      { ...PERSONAL_ROW, voicemail_greeting_url: "org-1/pn-1.wav" },
    ]);

    const res = await DELETE(deleteReq(), idParams("pn-1"));

    expect(res.status).toBe(200);
    expect(svc.removed).toEqual([
      { bucket: "phone-voicemail-greetings", paths: ["org-1/pn-1.wav"] },
    ]);
    const upd = svc.updates.find((u) => u.table === "phone_numbers");
    expect(upd!.patch.voicemail_greeting_url).toBeNull();
    const json = await res.json();
    expect(json.voicemail_greeting_url).toBeNull();
  });

  it("is a no-op clear when there is no greeting set (nulls the column, removes nothing)", async () => {
    asOwner();
    const svc = seedService([PERSONAL_ROW]); // voicemail_greeting_url: null

    const res = await DELETE(deleteReq(), idParams("pn-1"));

    expect(res.status).toBe(200);
    expect(svc.removed).toHaveLength(0);
    const upd = svc.updates.find((u) => u.table === "phone_numbers");
    expect(upd!.patch.voicemail_greeting_url).toBeNull();
  });

  it("403s a non-owner trying to clear someone else's Personal greeting", async () => {
    asOtherMember();
    const svc = seedService([
      { ...PERSONAL_ROW, voicemail_greeting_url: "org-1/pn-1.wav" },
    ]);

    const res = await DELETE(deleteReq(), idParams("pn-1"));

    expect(res.status).toBe(403);
    // The owner's greeting object is untouched.
    expect(svc.removed).toHaveLength(0);
    expect(svc.updates).toHaveLength(0);
  });

  it("401s an unauthenticated caller", async () => {
    authed({ user: null });
    const svc = seedService([
      { ...PERSONAL_ROW, voicemail_greeting_url: "org-1/pn-1.wav" },
    ]);

    const res = await DELETE(deleteReq(), idParams("pn-1"));

    expect(res.status).toBe(401);
    expect(svc.removed).toHaveLength(0);
  });
});
