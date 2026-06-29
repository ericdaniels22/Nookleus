// #606 — the Showcase publish panel in the builder: the Draft/Published badge,
// the "View live post" link, the one-click consent checkbox + Publish button,
// and the distinct, visible error the route hands back (revoked credential vs
// unreachable site vs a privacy-scrub block). These tests drive that behavior
// through the DOM and assert what the Publish POST carries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

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
    gbp_post_name: null,
    gbp_post_url: null,
    gbp_published_at: null,
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

// The GBP route returns the same publish-view shape (deriveShowcaseGbpPublishState).
const gbpPublishedView = {
  state: "published",
  liveUrl: "https://www.google.com/search?q=gbp-post",
  publishedAt: "2026-06-29T12:00:00.000Z",
};

function stubGbp(result: { status?: number; body?: unknown }) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (
      url === "/api/jobs/job-1/showcases/sc-1/publish-gbp" &&
      init?.method === "POST"
    ) {
      return json(result.body ?? gbpPublishedView, result.status ?? 200);
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
  screen.getByRole("button", {
    name: /publish to website/i,
  }) as HTMLButtonElement;

// Each channel is its own labeled group so its badge, link, button, and error
// can be asserted independently (AC#3).
const websiteRow = () => screen.getByRole("group", { name: /^website$/i });
const gbpRow = () =>
  screen.getByRole("group", { name: /google business profile/i });

const gbpPublishButton = () =>
  within(gbpRow()).getByRole("button", {
    name: /publish to google business profile/i,
  }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShowcasePublishPanel — draft (#606)", () => {
  it("shows a Draft state, a consent checkbox, and a Publish button gated on consent", () => {
    stubPublish({});
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    expect(within(websiteRow()).getByText(/draft/i)).toBeDefined();
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

describe("ShowcasePublishPanel — Google Business Profile channel (#609)", () => {
  it("renders an independent GBP row: its own Draft badge and a consent-gated Publish to Google Business Profile button, with no live link", () => {
    stubPublish({});
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    const gbp = gbpRow();
    // The Business Profile channel starts as its own Draft, separate from the
    // website row.
    expect(within(gbp).getByText(/draft/i)).toBeDefined();
    // No post yet → no "View on Google" link.
    expect(
      within(gbp).queryByRole("link", { name: /view on google/i }),
    ).toBeNull();
    // Same consent gate as the website (AC#4): disabled until the box is checked.
    expect(gbpPublishButton().disabled).toBe(true);
  });

  it("posts consent to the GBP route and flips the GBP row to Published with a View on Google link", async () => {
    const fetchSpy = stubGbp({ body: gbpPublishedView });
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    fireEvent.click(consentBox());
    fireEvent.click(gbpPublishButton());

    // The POST carries the same one-click consent the route requires (AC#4).
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        (c) => String(c[0]) === "/api/jobs/job-1/showcases/sc-1/publish-gbp",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        consent: true,
      });
    });

    // On success the GBP row reflects the now-live Business Profile post.
    await waitFor(() => {
      const link = within(gbpRow()).getByRole("link", {
        name: /view on google/i,
      }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(gbpPublishedView.liveUrl);
    });
  });

  it("reads each channel's published state independently: GBP live while the website is still a draft (AC#3)", () => {
    stubPublish({});
    render(
      <ShowcasePublishPanel
        jobId="job-1"
        showcase={draftShowcase({
          gbp_post_name: "accounts/1/locations/2/localPosts/9",
          gbp_post_url: "https://www.google.com/search?q=gbp-post",
          gbp_published_at: "2026-06-29T00:00:00.000Z",
        })}
      />,
    );

    // The website channel is untouched — still a Draft with no live link.
    expect(within(websiteRow()).getByText(/draft/i)).toBeDefined();
    expect(
      within(websiteRow()).queryByRole("link", { name: /view live post/i }),
    ).toBeNull();

    // The GBP channel is live, on its own evidence (its recorded local post).
    const gbp = gbpRow();
    expect(within(gbp).getByText(/published/i)).toBeDefined();
    const link = within(gbp).getByRole("link", {
      name: /view on google/i,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/search?q=gbp-post",
    );
  });

  it("surfaces the GBP route's distinct failure message in the GBP row and stays a draft (AC#5)", async () => {
    const message =
      "Connect Google in Settings before publishing a Showcase to your Business Profile.";
    stubGbp({ status: 409, body: { code: "not_connected", message } });
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    fireEvent.click(consentBox());
    fireEvent.click(gbpPublishButton());

    const alert = await within(gbpRow()).findByRole("alert");
    expect(alert.textContent).toContain(message);
    // The publish failed → the GBP row is still a draft, with no live link.
    expect(
      within(gbpRow()).queryByRole("link", { name: /view on google/i }),
    ).toBeNull();
  });

  it("keeps the two channels' errors independent: a GBP failure shows no alert on the website row (AC#3, AC#5)", async () => {
    stubGbp({
      status: 422,
      body: {
        code: "gbp_permission_denied",
        message:
          "Google rejected the publish — the connected account can't manage this Business Profile. Reconnect in Settings, then publish again.",
      },
    });
    render(<ShowcasePublishPanel jobId="job-1" showcase={draftShowcase()} />);

    fireEvent.click(consentBox());
    fireEvent.click(gbpPublishButton());

    // The failure lands in the GBP row...
    await within(gbpRow()).findByRole("alert");
    // ...and the website row carries no error of its own.
    expect(within(websiteRow()).queryByRole("alert")).toBeNull();
  });
});
