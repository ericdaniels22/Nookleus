# Marketing suite publishes to the org's own website and goes direct to Google; social aggregator deferred

**Status:** Accepted
**Date:** 2026-06-10 (grilling session for issue #538)

## Context

Issue #538 ("Marketing Suite Upgrade") proposes four pillars: Showcases
(portfolio), social publishing, review management, and insights — plus
Google Business Profile sync and a Google Ads question. The half-built
`/marketing` tab already AI-drafts social copy into `marketing_drafts`,
but nothing publishes anywhere. The grilling session resolved where
content lives and which integrations carry the first slices.

## Decision

1. **A Showcase publishes onto the Organization's own website, not a
   Nookleus-hosted page.** Via a **Website connection** (WordPress REST
   API + a posts-scoped Application Password; see CONTEXT.md). The SEO
   value of fresh, geo-tagged project content must accrue to the org's
   own domain (for AAA: aaadisasterrecovery.com) — Nookleus is a content
   feeder, never a web host. Orgs without WordPress simply have no site
   publishing for now.
2. **Google integrations are direct, not via an aggregator.** One
   per-org Google OAuth connection carries GBP reviews (the first
   slice: read + AI-drafted human-approved replies), GBP posts, GBP
   performance, Search Console, Google Ads, and Local Services Ads
   reporting (both read-only). Review scope is **Google-only** —
   Facebook needs the deferred Meta app review; Yelp has no reply API.
3. **Social publishing (FB/IG/LinkedIn/TikTok/X) is deferred.** It is
   the lowest-priority pillar. When it comes, the plan is **hybrid**: a
   middleman aggregator (e.g. Ayrshare) rather than six per-platform
   API approval processes (realistically 1–3 months before the first
   automated post). The deferral is deliberate — do not "finish" the
   marketing_drafts platforms by building direct Meta/TikTok/X
   integrations.
4. **Showcase privacy is a product rule, not reviewer discretion.**
   Drafts scrub identifying customer details by default (city-level
   location only — also what local SEO wants); publishing requires a
   one-click "customer is OK with these photos" confirmation.

## Considered options

- **Nookleus-hosted public portfolio pages.** Rejected: the SEO accrues
  to Nookleus's domain instead of the customer's, and it makes Nookleus
  a public web host (custom domains, uptime, indexing) for no gain.
- **Embed widget on the org's site.** Rejected as primary: JS-served
  content is weaker for indexing and styling; may return as a
  homepage strip later.
- **Direct social APIs now.** Rejected: months of Meta/LinkedIn/TikTok/X
  approvals for the pillar the owner ranked last.
- **Aggregator for everything, including reviews.** Rejected: a monthly
  fee for capability Google grants directly, and the wanted GBP depth
  (hours, services, performance) needs the direct API regardless.

## Consequences

- Confirmed build order: ① Google connection + reviews, ② Showcases →
  WordPress, ③ Showcase → GBP post (free extra channel on the same
  API), ④ Insights v1 answering cost-per-lead by source. Deferred:
  social aggregator, GBP hours/services editing, campaign management.
- Google Cloud project + API access applications (GBP API, Ads
  developer token) must be filed on day one of slice ①; approvals
  take days to weeks and gate live data, not the build.
- Review requests are **manual-only**: a button on the job page (no
  auto-send, no nudge list) — the owner keeps per-customer judgment.
- A one-time, non-product task accompanies slice ②: add a "Recent
  Projects" nav item + post template to the `aaa-website-wp` theme.
