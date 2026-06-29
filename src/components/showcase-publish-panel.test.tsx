// #606 — the Showcase publish panel in the builder: the Draft/Published badge,
// the "View live post" link, the one-click consent checkbox + Publish button,
// and the distinct, visible error the route hands back (revoked credential vs
// unreachable site vs a privacy-scrub block). These tests drive that behavior
// through the DOM and assert what the Publish POST carries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ShowcasePublishPanel from "./showcase-publish-panel";
import type { Showcase } from "@/lib/types";

function draftShowcase(over: Partial<Showcase> = {}): Showcase {
  return {
    id: "sc-1",
    organization_id: "org-1",
    job_id: "job-1",
    title: "Storm-torn roof, made whole",
    write_up: "We replaced the whole roof after the spring storms.",
    photo_ids: [],
    status: "draft",
    created_by: "user-1",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
    wordpress_post_id: null,
    wordpress_post_url: null,
    published_at: null,
    consent_confirmed_by: null,
    consent_confirmed_at: null,
    ...over,
  };
}

function publishedShowcase(over: Partial<Showcase> = {}): Showcase {
  return draftShowcase({
    status: "published",
    wordpress_post_id: "42",
    wordpress_post_url: "https://example.com/projects/storm-roof",
    published_at: "2026-06-28T12:00:00.000Z",
    consent_confirmed_by: "user-1",
    consent_confirmed_at: "2026-06-28T12:00:00.000Z",
    ...over,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// The publish-view shape the route returns on success.
const publishedView = {
  state: "published",
  liveUrl: "https://example.com/projects/storm-roof",
  publishedAt: "2026-06-29T12:00:00.000Z",
};

function stubPublish(result: { status?: number; body?: unknown }) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (
      url === "/api/jobs/job-1/showcases/sc-1/publish" &&
      init?.method === "POST"
    ) {
      return json(result.body ?? publishedView, result.status ?? 200);
    }
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const consentBox = () =>
  screen.getByRole("checkbox", {
    name: /customer'?s ok to show these photos/i,
  }) as HTMLInputElement;

const publishButton = () =>
  screen.getByRole("button", { name: /publish/i }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShowcasePublishPanel — draft (#606)", () => {
  it("shows a Draft state, a consent checkbox, and a Publish button gated on consent", () => {
    stubPublish({});
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    expect(screen.getByText(/draft/i)).toBeDefined();
    // A draft has no live post to view.
    expect(screen.queryByRole("link", { name: /view live post/i })).toBeNull();

    expect(consentBox().checked).toBe(false);
    // Publish is disabled until the admin affirms consent (AC#1).
    expect(publishButton().disabled).toBe(true);
  });

  it("enables Publish once the consent box is checked", () => {
    stubPublish({});
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    fireEvent.click(consentBox());

    expect(consentBox().checked).toBe(true);
    expect(publishButton().disabled).toBe(false);
  });
});

describe("ShowcasePublishPanel — published (#606)", () => {
  it("shows a Published state with a live link to the post", () => {
    stubPublish({});
    render(
      <ShowcasePublishPanel jobId="job-1" showcase={publishedShowcase()} />,
    );

    expect(screen.getByText(/published/i)).toBeDefined();
    const link = screen.getByRole("link", {
      name: /view live post/i,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://example.com/projects/storm-roof",
    );
  });
});

describe("ShowcasePublishPanel — publishing (#606)", () => {
  it("posts consent and flips to Published with the live link on success", async () => {
    const fetchSpy = stubPublish({ body: publishedView });
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    fireEvent.click(consentBox());
    fireEvent.click(publishButton());

    // The POST carries the one-click consent the route requires.
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        (c) => String(c[0]) === "/api/jobs/job-1/showcases/sc-1/publish",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        consent: true,
      });
    });

    // On success the panel reflects the now-live post.
    await waitFor(() => {
      const link = screen.getByRole("link", {
        name: /view live post/i,
      }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(
        "https://example.com/projects/storm-roof",
      );
    });
  });
});

describe("ShowcasePublishPanel — distinct errors (#606, AC#5)", () => {
  async function publishWith(result: { status: number; body: unknown }) {
    stubPublish(result);
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);
    fireEvent.click(consentBox());
    fireEvent.click(publishButton());
  }

  it("surfaces the revoked-credential message on a 422 invalid_credentials", async () => {
    const message =
      "WordPress rejected the saved credential. Reconnect your website in Settings, then publish again.";
    await publishWith({
      status: 422,
      body: { code: "invalid_credentials", message },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    // Still a draft — the publish failed, so no live link appears.
    expect(screen.queryByRole("link", { name: /view live post/i })).toBeNull();
  });

  it("surfaces the unreachable-site message on a 502 wordpress_unreachable", async () => {
    const message =
      "Couldn't reach your website. Check that it's online and try again — your connection is unchanged.";
    await publishWith({
      status: 502,
      body: { code: "wordpress_unreachable", message },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
  });

  it("lists the leaked values on a 422 privacy_scrub_blocked", async () => {
    await publishWith({
      status: 422,
      body: {
        code: "privacy_scrub_blocked",
        message:
          'This Showcase still shows the customer\'s name ("John Smith"). Remove it before publishing — only city-level location may be public.',
        violations: [{ field: "customer_name", match: "John Smith" }],
      },
    });

    const alert = await screen.findByRole("alert");
    // The exact leaked value the admin must remove is named.
    expect(alert.textContent).toContain("John Smith");
  });
});
