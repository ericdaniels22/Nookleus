// #609 — publishing a Showcase to the Organization's Google Business Profile as
// a local post (an "update"). These tests pin the deep module the publish-gbp
// route leans on: the pure summarizer that fits a Showcase into the Business
// Profile length limit, and the v4 REST client that creates OR updates exactly
// one local post (never a duplicate) and classifies its failures.

import { describe, it, expect } from "vitest";

import {
  summarizeShowcaseForGbp,
  publishShowcaseGbpPost,
  GbpPublishError,
  isGbpAuthError,
} from "./showcase-gbp-post";

// A fake authorized client: its `.fetch` records every call and returns a canned
// v4 LocalPost (or a non-ok status to simulate a Google failure). Mirrors the
// reviews route's useGoogleClient fake.
function fakeGbpClient(opts: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = {
    fetch: async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify(
          opts.body ?? {
            name: "accounts/1/locations/2/localPosts/9",
            searchUrl: "https://www.google.com/search?q=gbp-post",
          },
        ),
        {
          status: opts.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
  return { client, calls };
}

describe("summarizeShowcaseForGbp", () => {
  it("composes the title and write-up into a single plain-text summary", () => {
    const summary = summarizeShowcaseForGbp({
      title: "Storm-torn roof, made whole",
      writeUp: "We replaced the whole roof after the spring storms.",
    });

    expect(summary).toBe(
      "Storm-torn roof, made whole\n\nWe replaced the whole roof after the spring storms.",
    );
  });

  it("truncates to the Business Profile length limit at a word boundary (AC#2)", () => {
    // A write-up well past the 1500-char local-post limit, built from whole
    // words so the boundary cut lands on a space.
    const writeUp = "roofing ".repeat(400).trim(); // ~3199 chars
    const summary = summarizeShowcaseForGbp({ title: "Big job", writeUp });

    // Respects the length constraint, ellipsis included.
    expect(summary.length).toBeLessThanOrEqual(1500);
    expect(summary.endsWith("…")).toBe(true);

    // The kept text is a clean prefix of the full content — nothing rewritten —
    // and ends on a whole word, never mid-"roofing".
    const kept = summary.slice(0, -1);
    const full = `Big job\n\nroofing ${writeUp.slice("roofing ".length)}`;
    expect(`Big job\n\n${writeUp}`.startsWith(kept)).toBe(true);
    expect(/roofing$/.test(kept.trimEnd())).toBe(true);
    expect(full.length).toBeGreaterThan(1500); // sanity: the input did overflow
  });
});

describe("publishShowcaseGbpPost", () => {
  it("creates a new local post with one photo (AC#1) and returns its name + url", async () => {
    const { client, calls } = fakeGbpClient();

    const result = await publishShowcaseGbpPost(
      client,
      "accounts/1/locations/2",
      { summary: "We replaced the roof.", photoUrl: "https://sb.test/p/one.jpg" },
      null, // first publish → create
    );

    // POST to the v4 localPosts collection for the location.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts",
    );
    expect(calls[0].init?.method).toBe("POST");

    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.summary).toBe("We replaced the roof.");
    expect(sent.topicType).toBe("STANDARD");
    // Exactly one PHOTO media item — the Business Profile media constraint.
    expect(sent.media).toEqual([
      { mediaFormat: "PHOTO", sourceUrl: "https://sb.test/p/one.jpg" },
    ]);

    expect(result).toEqual({
      name: "accounts/1/locations/2/localPosts/9",
      url: "https://www.google.com/search?q=gbp-post",
    });
  });

  it("re-pushes the SAME post via PATCH when a post name is recorded (never a duplicate)", async () => {
    const { client, calls } = fakeGbpClient();

    const result = await publishShowcaseGbpPost(
      client,
      "accounts/1/locations/2",
      { summary: "Updated story.", photoUrl: "https://sb.test/p/one.jpg" },
      "accounts/1/locations/2/localPosts/9", // already published → update
    );

    expect(calls).toHaveLength(1);
    // PATCH the recorded LocalPost by name with an updateMask — not a fresh POST
    // to the collection, which would stack a duplicate update on the profile.
    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[0].url).toContain(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts/9",
    );
    expect(calls[0].url).toContain("updateMask=");
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.summary).toBe("Updated story.");
    expect(result.name).toBe("accounts/1/locations/2/localPosts/9");
  });

  it("throws a GbpPublishError carrying the HTTP status when Google rejects the post (AC#5)", async () => {
    const { client } = fakeGbpClient({
      status: 500,
      body: { error: { code: 500, status: "INTERNAL", message: "backend error" } },
    });

    const err = await publishShowcaseGbpPost(
      client,
      "accounts/1/locations/2",
      { summary: "We replaced the roof.", photoUrl: "https://sb.test/p/one.jpg" },
      null,
    ).catch((e: unknown) => e);

    // A non-ok response is never silently treated as a published post — it
    // surfaces as a typed error the route can classify (AC#5).
    expect(err).toBeInstanceOf(GbpPublishError);
    expect((err as GbpPublishError).status).toBe(500);
  });
});

describe("isGbpAuthError", () => {
  it("treats 401 and 403 as a permission failure (reconnect) and everything else as transient (AC#5)", () => {
    // 401 (token rejected) and 403 (account lacks manage rights on the profile)
    // are the only signals that the CONNECTION can't publish — the route flips it
    // broken and prompts a reconnect.
    expect(isGbpAuthError(new GbpPublishError(401, "UNAUTHENTICATED", "no"))).toBe(true);
    expect(isGbpAuthError(new GbpPublishError(403, "PERMISSION_DENIED", "no"))).toBe(true);

    // A 5xx / 429 / network blip is transient — never break the connection on it.
    expect(isGbpAuthError(new GbpPublishError(500, "INTERNAL", "no"))).toBe(false);
    expect(isGbpAuthError(new GbpPublishError(429, "RESOURCE_EXHAUSTED", "no"))).toBe(false);
    expect(isGbpAuthError(new Error("network down"))).toBe(false);
  });
});
