// @vitest-environment node
// Server route test — Node env so the JSON Request round-trips with
// undici (jsdom ships no global Request).
//
// Issue #201 — when Jarvis Core routes a turn to a department, the Chat
// `attachments` list (#200) rides on the internal department-call body.
// These integration-style tests drive POST /api/jarvis/chat and assert
// the attachment references reach the department `fetch`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createMock, betaCreateMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  betaCreateMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
    beta = { messages: { create: betaCreateMock } };
  },
  toFile: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  makeAuthedFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

const routeCtx = { params: Promise.resolve({}) };

const IMAGE_ATTACHMENT = {
  kind: "image" as const,
  storage_path: "org-1/conv-1/photo.png",
  media_type: "image/png",
};

function chatRequest(body: unknown): Request {
  return new Request("http://test/api/jarvis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The internal department call the chat route makes — found by URL among
// every fetch the route issued.
function departmentCall(
  fetchMock: ReturnType<typeof vi.fn>,
  endpoint: string,
): { url: string; body: Record<string, unknown> } | undefined {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes(`/api/jarvis/${endpoint}`),
  );
  if (!call) return undefined;
  return { url: String(call[0]), body: JSON.parse(call[1].body as string) };
}

// True when any message carries an image or document content block.
function hasAttachmentBlock(messages: { content: unknown }[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((b) =>
        ["image", "document"].includes((b as { type?: string }).type ?? ""),
      ),
  );
}

describe("POST /api/jarvis/chat — attachments follow routing (#201)", () => {
  let service: SupabaseFake;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    service = makeSupabaseFake();
    service.seed("user_profiles", [{ id: "user-1", full_name: "Eric" }]);
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin", orgId: "org-1" }) as never,
    );

    // The department call is mocked — these tests assert on the body the
    // chat route sends, not on a real department response.
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "R&D analysed the photo." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // The personality pass that re-renders the department answer.
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Here's what R&D found." }],
    });
    // The normal-Jarvis branch (not exercised on a routed turn).
    betaCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards attachments to the department on the @-prefix path", async () => {
    const res = await POST(
      chatRequest({
        context_type: "general",
        message: "@rnd what's wrong with this beam?",
        attachments: [IMAGE_ATTACHMENT],
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.routed_to).toBe("rnd");

    const rndCall = departmentCall(fetchMock, "rnd");
    expect(rndCall).toBeDefined();
    // The attachments list rode along on the internal department call.
    expect(rndCall!.body.attachments).toEqual([IMAGE_ATTACHMENT]);
    // ...with the caller's org id so the department can scope-check it.
    expect(rndCall!.body.org_id).toBe("org-1");
    // ...and the @rnd prefix is stripped from the forwarded question.
    expect(rndCall!.body.question).toBe("what's wrong with this beam?");
  });

  it("forwards attachments when a department is selected via mode", async () => {
    // `direct_department` is the UI department-mode field — a distinct
    // trigger from the @marketing text prefix, same forwarding contract.
    const res = await POST(
      chatRequest({
        context_type: "general",
        direct_department: "marketing",
        message: "Write a caption for this.",
        attachments: [IMAGE_ATTACHMENT],
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).routed_to).toBe("marketing");

    const marketingCall = departmentCall(fetchMock, "marketing");
    expect(marketingCall).toBeDefined();
    expect(marketingCall!.body.attachments).toEqual([IMAGE_ATTACHMENT]);
    expect(marketingCall!.body.org_id).toBe("org-1");
  });

  it("forwards attachments when a restoration term auto-routes to Field Ops", async () => {
    service.seed("jobs", [
      {
        id: "job-1",
        organization_id: "org-1",
        job_number: "1001",
        property_address: "12 Main St",
        status: "in_progress",
        damage_type: "water",
        created_at: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const res = await POST(
      chatRequest({
        context_type: "job",
        job_id: "job-1",
        // No @-prefix — "water damage" auto-routes the turn to Field Ops.
        message: "there's water damage in the basement",
        attachments: [IMAGE_ATTACHMENT],
      }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).routed_to).toBe("field-ops");

    const fieldOpsCall = departmentCall(fetchMock, "field-ops");
    expect(fieldOpsCall).toBeDefined();
    // Auto-routing never silently drops the photo.
    expect(fieldOpsCall!.body.attachments).toEqual([IMAGE_ATTACHMENT]);
    expect(fieldOpsCall!.body.org_id).toBe("org-1");
  });

  it("forwards the full attachments list (plural integrity)", async () => {
    // A user can attach up to five Chat attachments per turn (#200). All
    // of them must reach the department — none silently dropped along
    // the way to the internal call.
    const attachments = [
      IMAGE_ATTACHMENT,
      {
        kind: "image" as const,
        storage_path: "org-1/conv-1/before.jpg",
        media_type: "image/jpeg",
      },
      {
        kind: "pdf" as const,
        storage_path: "org-1/conv-1/scope.pdf",
        media_type: "application/pdf",
        filename: "scope.pdf",
        file_id: "file_xyz",
      },
    ];

    await POST(
      chatRequest({
        context_type: "general",
        message: "@rnd review these",
        attachments,
      }),
      routeCtx,
    );

    const rndCall = departmentCall(fetchMock, "rnd");
    expect(rndCall).toBeDefined();
    expect(rndCall!.body.attachments).toEqual(attachments);
    expect(
      (rndCall!.body.attachments as unknown[]).length,
    ).toBe(3);
  });

  it("keeps the personality-pass relay text-only", async () => {
    await POST(
      chatRequest({
        context_type: "general",
        message: "@rnd what's wrong with this beam?",
        attachments: [IMAGE_ATTACHMENT],
      }),
      routeCtx,
    );

    // The only Claude call the chat route makes on a routed turn is the
    // personality pass — it relays the department's text answer in
    // Jarvis's voice and must never carry the image or document itself.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(betaCreateMock).not.toHaveBeenCalled();
    const personalityMessages = createMock.mock.calls[0][0].messages;
    expect(hasAttachmentBlock(personalityMessages)).toBe(false);
    expect(typeof personalityMessages[0].content).toBe("string");
  });
});
