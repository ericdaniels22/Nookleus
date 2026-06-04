import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/pdf-presets", () => ({
  getDefaultPreset: vi.fn(),
}));
// Mock only the render-only helper; keep PdfRenderInputError real so the
// route's `instanceof` 404-mapping works against the genuine class.
vi.mock("@/lib/pdf-renderer/render-and-upload", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/pdf-renderer/render-and-upload")
    >();
  return { ...actual, renderInvoicePdfBuffer: vi.fn() };
});

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getDefaultPreset } from "@/lib/pdf-presets";
import {
  renderInvoicePdfBuffer,
  PdfRenderInputError,
} from "@/lib/pdf-renderer/render-and-upload";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/invoices/i-1/preview");
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const FAKE_PDF = Buffer.from("%PDF-1.7\nfake-invoice-bytes");

describe("GET /api/invoices/[id]/preview — inline customer-facing PDF (#385)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseFake().client as never,
    );
  });

  // The heart of #385 for invoices: View opens the *real* customer-facing PDF
  // inline. A permitted caller gets the rendered bytes with an inline
  // Content-Disposition so the browser renders it in place.
  it("streams the rendered PDF inline for a permitted caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(getDefaultPreset).mockResolvedValue({ id: "preset-1" } as never);
    vi.mocked(renderInvoicePdfBuffer).mockResolvedValue({
      buffer: FAKE_PDF,
      documentNumber: "INV-2002",
      jobNumber: "JOB-1",
    } as never);

    const res = await GET(makeRequest(), paramsFor("i-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FAKE_PDF)).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await GET(makeRequest(), paramsFor("i-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await GET(makeRequest(), paramsFor("i-1"));
    expect(res.status).toBe(403);
  });

  // View is read-only — editing stays in the builder — so it never mutates
  // the invoice. A not-found / cross-org invoice surfaces as a clean 404.
  it("returns 404 when the invoice is not found", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(getDefaultPreset).mockResolvedValue({ id: "preset-1" } as never);
    vi.mocked(renderInvoicePdfBuffer).mockRejectedValue(
      new PdfRenderInputError("invoice not found", 404),
    );
    const res = await GET(makeRequest(), paramsFor("missing"));
    expect(res.status).toBe(404);
  });
});
