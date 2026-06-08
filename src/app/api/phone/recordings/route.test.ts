// @vitest-environment node
// PRD #304 — Nookleus Phone. Slice 9 (#313).
//
// Tests for the voicemail-recording signed-URL route. The thread renders a
// voicemail's audio in an <audio> element; the browser needs a short-lived
// public URL for the stored MP3. Mirrors GET /api/phone/attachments —
// view_phone gated, service-client signing, cross-org reads refused at the
// path level (objects live under `{org}/...` in the phone-recordings bucket).

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

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const ORG = "org-1";
const routeCtx = { params: Promise.resolve({}) };

function getRequest(path: string): Request {
  return new Request(
    `http://test/api/phone/recordings?path=${encodeURIComponent(path)}`,
  );
}

// Service-client fake exposing only storage.createSignedUrl, recording the
// bucket + path it was asked to sign.
function makeService() {
  const signed: Array<{ bucket: string; path: string }> = [];
  return {
    signed,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async createSignedUrl(path: string) {
              signed.push({ bucket, path });
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

function authed(userId: string, role: "admin" | "crew_lead" | "crew_member") {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: { id: userId },
      tables: memberTables({
        userId,
        role,
        grants: role === "crew_member" ? [] : ["view_phone"],
      }),
    }) as never,
  );
}

function unauthed() {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({ user: null }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue(ORG);
});

describe("GET /api/phone/recordings — signed URL", () => {
  it("401 when unauthenticated", async () => {
    unauthed();
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(getRequest("org-1/rec.mp3"), routeCtx);
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks view_phone (crew_member)", async () => {
    authed("u-cm", "crew_member");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(getRequest("org-1/rec.mp3"), routeCtx);
    expect(res.status).toBe(403);
  });

  it("400 when no path is given", async () => {
    authed("u-1", "crew_lead");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(
      new Request("http://test/api/phone/recordings"),
      routeCtx,
    );
    expect(res.status).toBe(400);
  });

  it("404 for a path outside the caller's organization", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    const res = await GET(getRequest("org-OTHER/secret.mp3"), routeCtx);
    expect(res.status).toBe(404);
    // Never even attempted to sign a cross-org object.
    expect(svc.signed).toHaveLength(0);
  });

  it("returns a signed URL on the phone-recordings bucket for an in-org path", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    const res = await GET(getRequest("org-1/rec.mp3"), routeCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://signed/phone-recordings/org-1/rec.mp3");
    expect(svc.signed).toEqual([
      { bucket: "phone-recordings", path: "org-1/rec.mp3" },
    ]);
  });
});
