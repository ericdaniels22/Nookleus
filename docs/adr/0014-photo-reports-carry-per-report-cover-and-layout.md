# Photo Reports carry a per-report cover and per-report layout settings

**Status:** Accepted — supersedes [ADR 0003](0003-single-photo-report-layout.md) and [ADR 0009](0009-photo-reports-are-an-in-job-narrative-document.md) in part (issue #540)
**Date:** 2026-06-08

## Context

[ADR 0003](0003-single-photo-report-layout.md) collapsed Photo Reports to **one
hardcoded layout** — fixed cover page, fixed header/footer, fixed section divider
— on the reasoning that "every photo report this business produces serves the
same audience and benefits from looking the same every time," leaving
photos-per-page as the only knob. Its #361 amendment made that knob **global**
(Organization-wide, `company_settings.report_photos_per_page`).

[ADR 0009](0009-photo-reports-are-an-in-job-narrative-document.md) reversed 0003
for *section content* — Sections regained a one-page rich-text write-up — but
explicitly **kept the cover fixed**, **kept photos-per-page company-wide**, and
opened the builder **full-screen** with the app navigation stripped.

Issue #540 reworks the desktop builder against a provided mockup, and the owner
asked for control the "one look for everyone" rationale does not allow: a cover
that differs per report (different title, a chosen lead photo, some blocks
hidden), and per-report layout choices (how many photos per page, which
per-photo details show). In practice reports do **not** all serve the same
audience — an adjuster packet and an owner walk-through want different covers and
different photo density — so 0003's consistency rationale no longer holds for the
cover or the layout knobs. The owner also wants the app navigation reachable from
inside the builder.

## Decision

1. **The Cover Page becomes per-report customizable.** Each report owns its
   cover: an editable title, a cover photo chosen per report (seeded from the
   Job's cover photo, overridable), and a show/hide switch for each identifying
   block (logo, customer, property address, point of contact, insurance; all
   default on). This reverses the "fixed cover" that both 0003 and 0009 kept.

2. **Layout choices become per-report Report Settings, seeded from an
   Organization default.** A report carries its own copy of photos-per-page and
   the show/hide switches for Section Title Pages and each per-photo detail
   (photo number, captured-by, location, date, tags; all default on). A new
   report copies these from the Organization's **Report layout default**;
   thereafter the report keeps its own copy, so editing the Organization default
   never rewrites a report that already exists. This is the same per-document
   **snapshot** model as billing PDFs
   ([ADR 0012](0012-pdf-layout-is-a-per-document-snapshot.md)), and it reverses
   the "photos-per-page is global" of 0003's amendment and 0009.

3. **Photos-per-page changes from 1/2/4 to 2/3/4.** A new 3-per-page Photo Page
   layout is added; the 1-per-page (single large photo) layout is dropped.
   Reports and Organizations previously on 1-per-page fall back to the default
   (2).

4. **The Section write-up cap becomes per-layout.** The single 1500-character
   budget is replaced by a per-photos-per-page cap (2 → 750, 3 → 400, 4 → 260),
   still a conservatively-tuned character count with a live counter (per 0009).

5. **The builder is no longer full-screen.** The app navigation stays reachable
   inside the builder, collapsed by default. This reverses 0009's "full-screen,
   job-scoped builder."

6. **"Location captured" is the Job's property address.** Photos carry no GPS;
   the per-photo "location captured" detail prints the Job's property address
   (identical on every photo in a report). Photo Pages drop their running top
   header (customer + date) and keep only a slim footer (Section name + page
   number).

7. **Scope: desktop only.** The new layout (restored nav, left-rail section
   navigation, one-section-at-a-time editing, the Add-Photos picker, the Cover
   Page editor, the Report Settings panel, the Preview pane) is a **computer**
   (`lg`, ≥1024px) experience rendered with CSS breakpoints. The phone builder is
   unchanged and still renders below `lg`.

## Consequences

- Reverses the "single look / same audience" rationale of 0003 (already partly
  reversed by 0009) for the **cover** and the **layout knobs**, re-growing the
  surface area those ADRs shrank. Accepted because the business genuinely
  produces reports for different audiences.
- **Data-shape change** requiring a migration: `photo_reports` gains a per-report
  cover photo reference, the cover-block visibility flags, and the Report
  Settings (photos-per-page + detail toggles); the Organization gains a **Report
  layout default** (the seed). Old rows must be read-tolerant — a report with no
  stored settings reads as the Organization default, no stored cover config reads
  as "all blocks on," and no per-report cover photo falls back to the Job's.
- The PDF engine gains a **3-per-page Photo Page layout** and loses 1-per-page;
  the cover renderer becomes driven by per-report config rather than wholesale
  Job data; `resolvePhotosPerPage` widens to 2/3/4 and reads the report's
  snapshot (Organization default as fallback).
- Snapshot-on-create means a report's look is **stable** once created; an
  Organization changing its default is not a way to restyle existing reports
  (consistent with 0012). Restyling an existing report is a per-report edit.
- The builder's auto-save whitelist and reducer grow to carry the cover config,
  cover photo, and Report Settings alongside title/date/sections.
- Existing generated PDFs in the `reports` bucket are not regenerated; they keep
  their old layout as a historical record (consistent with 0003/0009).

## Considered options

- **Keep the cover and photos-per-page global; only restyle the builder UI.**
  Rejected: it ignores the actual driver — the owner wants per-report covers and
  density, which a global look cannot express.
- **Live (non-snapshot) settings: a report always reads the current Organization
  default.** Rejected in favor of the snapshot model (0012) so editing the
  default cannot silently change the look of reports already sent to an adjuster.
- **Keep 1-per-page alongside 2/3/4.** Rejected to match the mockup; the
  single-photo layout is dropped and its users fall back to the default.
- **Build text-alignment in the write-up to match the mockup toolbar.** Rejected:
  the rich-text → PDF mapping does not carry alignment and the canonical write-up
  is paragraphs + lists only, so the alignment buttons are dropped rather than
  shown-but-ignored.
- **Always-live Preview that re-renders on every keystroke.** Rejected for an
  on-demand Preview pane (refresh on click) that reuses the real PDF engine, so
  what you see is the actual output without paying a re-render on every edit.
