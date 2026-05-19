import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Issue #135 — when JarvisChat creates a row in `jarvis_conversations`
// for the first message of a fresh chat, the insert payload must carry
// `organization_id`. The `tenant_isolation_jarvis_conversations` RLS
// policy's WITH CHECK clause rejects an org-less insert; without that
// stamp on the payload, the typing indicator hangs forever in prod.

const insertSpy = vi.fn();

function makeToken(payload: object): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.sig`;
}

const tokenWithOrg = makeToken({
  app_metadata: { active_organization_id: "org-abc" },
});

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: tokenWithOrg } } }),
    },
    from: (table: string) => {
      if (table === "jarvis_conversations") {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertSpy(payload);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "conv-1", ...payload },
                    error: null,
                  }),
              }),
            };
          },
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () =>
                          Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// Stub out subcomponents whose internals aren't under test.
vi.mock("./JarvisMessage", () => ({ default: () => null }));
vi.mock("./JarvisQuickActions", () => ({ default: () => null }));
vi.mock("./JarvisTypingIndicator", () => ({ default: () => null }));
vi.mock("./JarvisWelcome", () => ({ default: () => null }));

import JarvisChat from "./JarvisChat";

describe("JarvisChat — new conversation insert (#135)", () => {
  beforeEach(() => {
    insertSpy.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: "hello back" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("stamps organization_id from the session JWT on the new-conversation insert", async () => {
    render(<JarvisChat contextType="general" />);

    const textarea = await screen.findByPlaceholderText(/Message Jarvis/i);
    fireEvent.change(textarea, { target: { value: "hello jarvis" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      organization_id: "org-abc",
    });
  });
});
