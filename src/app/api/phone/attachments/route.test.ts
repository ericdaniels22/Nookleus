// @vitest-environment node
// PRD #304 — Nookleus Phone. Slice 6 (#310).
//
// Tests for the MMS attachment upload + signed-URL route.
//
// POST: accepts a multipart upload, validates type+size, stores under the
// caller's Organization prefix in the `phone-attachments` bucket, and
// returns the storage path + media type the client then attaches to its
// outbound message.
//
// GET: mints a short-lived signed URL for an already-stored attachment
// path so the thread can render images and surface download links for
// non-image media.

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

import { POST, GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "@/app/api/email/__test-utils__/request-context-fakes";

const ORG = "org-1";

const routeCtx = { params: Promise.resolve({}) };

function postRequest(formData: FormData): Request {
  return new Request("http://test/api/phone/attachments", {
    method: "POST",
    body: formData,
  });
}

function getRequest(path: string): Request {
  return new Request(
    `http://test/api/phone/attachments?path=${encodeURIComponent(path)}`,
  );
}

function jpegFile(name = "damage.jpg", size = 1000): File {
  // Routes do not parse the bytes — a non-empty payload of the right type
  // is enough.
  const bytes = new Uint8Array(size).fill(0xff);
  return new File([bytes], name, { type: "image/jpeg" });
}

// Service-client fake with storage.upload + createSignedUrl. The route
// authenticates through the User-client wrapper but writes through the
// Service client; we mock only the calls the route makes.
function makeService() {
  const uploads: Array<{ bucket: string; path: string }> = [];
  const signed: Array<{ bucket: string; path: string }> = [];
  return {
    uploads,
    signed,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async upload(path: string) {
              uploads.push({ bucket, path });
              return { data: { path }, error: null };
            },
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

describe("POST /api/phone/attachments — auth + permission gate", () => {
  it("401 when unauthenticated", async () => {
    unauthed();
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const form = new FormData();
    form.append("file", jpegFile());
    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks view_phone (crew_member)", async () => {
    authed("u-cm", "crew_member");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const form = new FormData();
    form.append("file", jpegFile());
    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/phone/attachments — validation", () => {
  it("400 when no file is provided", async () => {
    authed("u-1", "crew_lead");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await POST(postRequest(new FormData()), routeCtx);
    expect(res.status).toBe(400);
  });

  it("400 with a clear error when the file is above the per-MMS size limit", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    const form = new FormData();
    // 5 MB + 1 byte — past Twilio's MMS ceiling.
    form.append("file", jpegFile("huge.jpg", 5 * 1024 * 1024 + 1));
    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(svc.uploads).toHaveLength(0);
  });

  it("400 with a clear error for an unsupported media type", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2])], "macro.bat", {
        type: "application/x-bat",
      }),
    );
    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(400);
    expect(svc.uploads).toHaveLength(0);
  });
});

describe("POST /api/phone/attachments — happy path", () => {
  it("stores a valid image and returns an org-scoped storage path", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);

    const form = new FormData();
    form.append("file", jpegFile("damage.jpg", 1024));
    const res = await POST(postRequest(form), routeCtx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachment).toMatchObject({
      media_type: "image/jpeg",
      kind: "image",
    });
    expect(body.attachment.storage_path).toMatch(/^org-1\/[0-9a-f-]+\.jpg$/);
    expect(svc.uploads).toHaveLength(1);
    expect(svc.uploads[0].bucket).toBe("phone-attachments");
    expect(svc.uploads[0].path).toBe(body.attachment.storage_path);
  });

  it("stores a PDF as a non-image attachment with a `file` kind", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);

    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2])], "estimate.pdf", {
        type: "application/pdf",
      }),
    );
    const res = await POST(postRequest(form), routeCtx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachment.kind).toBe("file");
    expect(body.attachment.media_type).toBe("application/pdf");
    expect(body.attachment.filename).toBe("estimate.pdf");
    expect(body.attachment.storage_path).toMatch(/^org-1\/[0-9a-f-]+\.pdf$/);
  });
});

describe("GET /api/phone/attachments — signed URL", () => {
  it("401 when unauthenticated", async () => {
    unauthed();
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(getRequest("org-1/abc.jpg"), routeCtx);
    expect(res.status).toBe(401);
  });

  it("400 when no path is given", async () => {
    authed("u-1", "crew_lead");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(
      new Request("http://test/api/phone/attachments"),
      routeCtx,
    );
    expect(res.status).toBe(400);
  });

  it("404 for a path outside the caller's organization", async () => {
    authed("u-1", "crew_lead");
    vi.mocked(createServiceClient).mockReturnValue(makeService().client as never);
    const res = await GET(getRequest("org-OTHER/secret.jpg"), routeCtx);
    expect(res.status).toBe(404);
  });

  it("returns a signed URL for an in-org path", async () => {
    authed("u-1", "crew_lead");
    const svc = makeService();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    const res = await GET(getRequest("org-1/abc.jpg"), routeCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://signed/phone-attachments/org-1/abc.jpg");
    expect(svc.signed).toEqual([
      { bucket: "phone-attachments", path: "org-1/abc.jpg" },
    ]);
  });
});

