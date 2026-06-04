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
  memberTables,
} from "../../../__test-utils__/request-context-fakes";
import { isOfficialInvoiceStatus } from "@/lib/invoice-status";

const routeCtx = { params: Promise.resolve({ id: "inv-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);
});

function markSentRequest() {
  return new Request("http://test/api/invoices/inv-1/mark-sent", { method: "POST" });
}

// Gated on `edit_invoices` (#104) — mark-sent is a status transition
// (draft → sent), so it sits with the lighter edit gate rather than
// /send's `manage_invoices`. The route body runs against the Service client.
describe("POST /api/invoices/[id]/mark-sent (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await POST(markSentRequest(), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when a non-admin lacks edit_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    const res = await POST(markSentRequest(), routeCtx);
    expect(res.status).toBe(403);
  });

  it("reaches the handler when the caller holds edit_invoices", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_invoices"],
        }),
      }) as never,
    );
    // The Service-client fake has no invoices row, so the handler's own
    // lookup returns 404 — proving the gate passed and the body ran.
    const res = await POST(markSentRequest(), routeCtx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("an admin passes the gate without holding the key", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );
    const res = await POST(markSentRequest(), routeCtx);
    expect(res.status).toBe(404);
  });

  // #383 — marking a draft sent is the manual trigger that makes an invoice
  // official. The route flips draft → sent and stamps sent_at; "sent" is a
  // status the official-invoice rule counts as a real bill.
  it("flips a draft to sent (official) and stamps sent_at", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "admin", grants: [] }),
      }) as never,
    );
    const service = fakeServiceClient({
      tables: { invoices: [{ id: "inv-1", status: "draft", deleted_at: null }] },
    });
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(markSentRequest(), routeCtx);
    expect(res.status).toBe(200);

    const update = service.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeDefined();
    const payload = update!.payload as { status: string; sent_at: string };
    expect(payload.status).toBe("sent");
    expect(isOfficialInvoiceStatus(payload.status)).toBe(true);
    expect(typeof payload.sent_at).toBe("string");
  });
});
