// @vitest-environment node
// Server route test — Node env so the JSON Request round-trips with
// undici (jsdom ships no global Request).
//
// Issue #201 — a Chat attachment follows the turn when Jarvis routes it
// to Field Ops, including the restoration-term auto-route. The internal
// department call carries the `attachments` list; the route resolves
// them to Claude image / document blocks via the shared content-block
// assembly module.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { betaCreateMock, createMock } = vi.hoisted(() => ({
  betaCreateMock: vi.fn(),
  createMock: vi.fn(),
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
vi.mock("@/lib/knowledge/embeddings", () => ({
  embedQuery: vi.fn(),
}));

import { POST } from "./route";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

const SERVICE_KEY = "test-service-key";

function internalRequest(body: unknown): NextRequest {
  return new Request("http://test/api/jarvis/field-ops", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-key": SERVICE_KEY,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function blocksByType(
  messages: { content: unknown }[],
  type: string,
): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if ((block as { type?: string }).type === type) {
        found.push(block as Record<string, unknown>);
      }
    }
  }
  return found;
}

describe("POST /api/jarvis/field-ops — attachments follow routing (#201)", () => {
  let service: SupabaseFake;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);
    const ok = {
      content: [{ type: "text", text: "Category 2 water — get air movers in." }],
      stop_reason: "end_turn",
    };
    betaCreateMock.mockResolvedValue(ok);
    createMock.mockResolvedValue(ok);
  });

  it("forwards an attached image to the Field Ops agent as an image block", async () => {
    service.seedBlob(
      "jarvis-attachments/org-1/conv-7/damage.jpg",
      new Uint8Array([5, 6, 7, 8]),
    );

    const res = await POST(
      internalRequest({
        question: "What category of water damage is this?",
        org_id: "org-1",
        attachments: [
          {
            kind: "image",
            storage_path: "org-1/conv-7/damage.jpg",
            media_type: "image/jpeg",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(betaCreateMock).toHaveBeenCalled();

    const sentMessages = betaCreateMock.mock.calls[0][0].messages;
    const images = blocksByType(sentMessages, "image");
    expect(images).toHaveLength(1);
    expect(images[0].source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: Buffer.from([5, 6, 7, 8]).toString("base64"),
    });
  });
});
