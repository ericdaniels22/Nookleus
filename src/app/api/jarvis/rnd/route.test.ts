// @vitest-environment node
// Server route test — Node env so the JSON Request round-trips with
// undici (jsdom ships no global Request).
//
// Issue #201 — a Chat attachment follows the turn when Jarvis Core routes
// it to a department. The internal department call carries the
// `attachments` list (#200 — up to five images and/or PDFs, #199); the
// department route resolves them to Claude image / document blocks via
// the shared content-block assembly module.
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

import { POST } from "./route";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeSupabaseFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

const SERVICE_KEY = "test-service-key";

function internalRequest(body: unknown): NextRequest {
  return new Request("http://test/api/jarvis/rnd", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-key": SERVICE_KEY,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// Every content block of `type` found anywhere in a Claude messages array.
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

describe("POST /api/jarvis/rnd — attachments follow routing (#201)", () => {
  let service: SupabaseFake;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    service = makeSupabaseFake();
    vi.mocked(createServiceClient).mockReturnValue(service.client as never);
    const ok = {
      content: [{ type: "text", text: "That's a cracked joist." }],
      stop_reason: "end_turn",
    };
    // Both mocks resolve so a test failure surfaces the missing image
    // block rather than a 500 from an undefined Anthropic response.
    betaCreateMock.mockResolvedValue(ok);
    createMock.mockResolvedValue(ok);
  });

  it("forwards an attached image to the R&D agent as an image block", async () => {
    service.seedBlob(
      "jarvis-attachments/org-1/conv-1/photo.png",
      new Uint8Array([1, 2, 3, 4]),
    );

    const res = await POST(
      internalRequest({
        question: "What's wrong with this beam?",
        org_id: "org-1",
        attachments: [
          {
            kind: "image",
            storage_path: "org-1/conv-1/photo.png",
            media_type: "image/png",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    // Department routes run on the beta Messages API (#199) so document
    // blocks can ride alongside image blocks.
    expect(betaCreateMock).toHaveBeenCalled();

    const sentMessages = betaCreateMock.mock.calls[0][0].messages;
    const images = blocksByType(sentMessages, "image");
    expect(images).toHaveLength(1);
    expect(images[0].source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
    });
  });

  it("forwards an attached PDF to the R&D agent as a document block", async () => {
    const res = await POST(
      internalRequest({
        question: "What does this contract say about scope?",
        org_id: "org-1",
        attachments: [
          {
            kind: "pdf",
            storage_path: "org-1/conv-2/contract.pdf",
            media_type: "application/pdf",
            filename: "contract.pdf",
            // A PDF rides by its Anthropic Files API file_id (#199) — the
            // bytes are not re-encoded turn after turn.
            file_id: "file_abc123",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);

    const sentMessages = betaCreateMock.mock.calls[0][0].messages;
    const documents = blocksByType(sentMessages, "document");
    expect(documents).toHaveLength(1);
    expect(documents[0].source).toEqual({
      type: "file",
      file_id: "file_abc123",
    });
    // A PDF reference is a file_id — storage is not touched.
    expect(service.state.storageDownloads).toHaveLength(0);
  });

  it("degrades to a text note for an image attachment outside the caller's org", async () => {
    service.seedBlob(
      "jarvis-attachments/org-OTHER/conv-1/secret.jpg",
      new Uint8Array([9, 9, 9]),
    );

    const res = await POST(
      internalRequest({
        question: "What's in this photo?",
        org_id: "org-1",
        attachments: [
          {
            kind: "image",
            storage_path: "org-OTHER/conv-1/secret.jpg",
            media_type: "image/jpeg",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);

    const sentMessages = betaCreateMock.mock.calls[0][0].messages;
    // The cross-org reference never becomes an image block...
    expect(blocksByType(sentMessages, "image")).toHaveLength(0);
    // ...and the org check fires before any bytes are loaded.
    expect(service.state.storageDownloads).toHaveLength(0);
    // The turn still reaches R&D as a text degradation note so it can
    // answer and explain the attachment is unavailable.
    const texts = blocksByType(sentMessages, "text").map(
      (b) => b.text as string,
    );
    expect(texts.join(" ")).toMatch(/image|attachment/i);
  });
});
