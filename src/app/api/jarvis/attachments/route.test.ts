// @vitest-environment node
// Server route test — uses Node's undici File/FormData/Request so the
// multipart body round-trips consistently (jsdom ships a separate File
// implementation that undici's FormData rejects).
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

// The Anthropic SDK is the integration boundary for the PDF path (#199):
// a PDF is uploaded to the Files API and the route records the file_id.
const anthropicFilesUpload = vi
  .fn()
  .mockResolvedValue({ id: "file_test123", type: "file" });
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function MockAnthropic() {
    return { beta: { files: { upload: anthropicFilesUpload } } };
  }),
  toFile: vi.fn(async (_bytes: unknown, filename: string) => ({
    name: filename,
  })),
}));

import { POST, GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

const routeCtx = { params: Promise.resolve({}) };

function postRequest(formData: FormData): Request {
  return new Request("http://test/api/jarvis/attachments", {
    method: "POST",
    body: formData,
  });
}

async function pngFile(name = "photo.png"): Promise<File> {
  const bytes = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 30, g: 60, b: 90 },
    },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function pdfFile(name = "contract.pdf"): File {
  // A minimal PDF byte sequence — the route stores bytes verbatim and does
  // not parse them, so a valid header is enough.
  const bytes = new TextEncoder().encode("%PDF-1.4\n%minimal\n");
  return new File([bytes], name, { type: "application/pdf" });
}

describe("POST /api/jarvis/attachments (#198)", () => {
  let service: SupabaseFake;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const form = new FormData();
    form.append("file", await pngFile());
    form.append("conversation_id", "conv-1");

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(401);
  });

  it("rejects an unsupported file type with a clear error", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "notes.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    form.append("conversation_id", "conv-1");

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/image|pdf/i);
    // Nothing should have been written to the bucket.
    expect(service.state.storageUploads).toHaveLength(0);
  });

  it("requires a conversation_id", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const form = new FormData();
    form.append("file", await pngFile());

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/conversation_id/i);
  });

  it("stores a valid image and returns an org-scoped attachment reference", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const form = new FormData();
    form.append("file", await pngFile());
    form.append("conversation_id", "conv-xyz");

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attachment.kind).toBe("image");
    expect(body.attachment.media_type).toBe("image/png");
    // Object path is org- and conversation-scoped (org-1 from the JWT claim).
    expect(body.attachment.storage_path).toMatch(
      /^org-1\/conv-xyz\/.+\.png$/,
    );

    expect(service.state.storageUploads).toHaveLength(1);
    expect(service.state.storageUploads[0].bucket).toBe("jarvis-attachments");
    expect(service.state.storageUploads[0].path).toBe(
      body.attachment.storage_path,
    );
  });

  it("stores a valid PDF and records the Anthropic file_id (#199)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const form = new FormData();
    form.append("file", pdfFile());
    form.append("conversation_id", "conv-pdf");

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attachment.kind).toBe("pdf");
    expect(body.attachment.media_type).toBe("application/pdf");
    // The PDF is uploaded to the Anthropic Files API and its file_id is
    // recorded on the reference so a replayed PDF is not re-encoded.
    expect(body.attachment.file_id).toBe("file_test123");
    expect(body.attachment.storage_path).toMatch(
      /^org-1\/conv-pdf\/.+\.pdf$/,
    );

    expect(service.state.storageUploads).toHaveLength(1);
    expect(service.state.storageUploads[0].bucket).toBe("jarvis-attachments");
  });

  it("rejects the attachment when the Anthropic Files API upload fails (#199)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    anthropicFilesUpload.mockRejectedValueOnce(new Error("Files API down"));

    const form = new FormData();
    form.append("file", pdfFile());
    form.append("conversation_id", "conv-pdf");

    const res = await POST(postRequest(form), routeCtx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

describe("GET /api/jarvis/attachments — org scoping (#198)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseFake().client as never,
    );
  });

  it("400s when no path is given", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await GET(
      new Request("http://test/api/jarvis/attachments"),
      routeCtx,
    );
    expect(res.status).toBe(400);
  });

  it("404s for a path outside the caller's organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await GET(
      new Request(
        "http://test/api/jarvis/attachments?path=" +
          encodeURIComponent("org-OTHER/conv-1/secret.jpg"),
      ),
      routeCtx,
    );
    expect(res.status).toBe(404);
  });
});
