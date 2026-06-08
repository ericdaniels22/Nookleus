# Photo Reports are an in-job, section-narrative document

**Status:** Accepted — supersedes [ADR 0003](0003-single-photo-report-layout.md) in part. Partly superseded by [ADR 0014](0014-photo-reports-carry-per-report-cover-and-layout.md) (issue #540) — the fixed cover and company-wide photos-per-page it kept become per-report, and the full-screen builder regains the (collapsed) app navigation.
**Date:** 2026-06-04

## Context

[ADR 0003](0003-single-photo-report-layout.md) (the May 2026 rework, issue #326)
collapsed Photo Reports to **one minimal hardcoded layout** — a near-empty
section divider page (big title + one-line subtitle) followed by photo pages —
on the reasoning that "every photo report this business produces serves the same
audience and benefits from looking the same every time," and that template
flexibility was unused.

In practice the reports need to carry **narrative**: the business routinely
writes full paragraphs and bullet-point findings / work-performed write-ups, and
the one-line subtitle has nowhere to put them. Separately, creating a report is
clunky — it happens off-job at a global `/reports/new` wizard whose first step is
a "select job" dropdown even when you started from a specific job, and a job's
existing reports are buried in an Overview card that only appears once a report
already exists (so you cannot start a job's *first* report from the job at all).
Issue #390 reworks both.

## Decision

1. **Photo Reports become an in-job feature.** A report is created from the
   **Job's Photos tab** (select photos → "Create report", alongside the existing
   Tag/Download/Delete bulk actions) and opens a **full-screen, job-scoped
   builder**. A job's reports are listed and reopened for editing from the **Job's
   Overview tab** (the documents tab, beside Estimates/Files/Contracts/Emails).
   The standalone global `/reports` area (list + wizard + its left-nav item) is
   **removed** — reports are reached only through their Job. Because creation
   always starts inside a Job, the "select job" step disappears entirely.

2. **Sections regain narrative structure.** A Section gains a **one-page
   rich-text write-up** (paragraphs and bullet/numbered lists) authored with the
   existing TipTap editor already used for Estimates/Invoices/contracts/email. It
   renders as a **section intro page** (heading + write-up) followed by the photo
   pages. The write-up is **capped to one page** via a conservatively tuned
   character limit with a live counter. This reintroduces per-section narrative
   that ADR 0003 had removed.

3. **Reports are fully editable and managed like documents.** A report is
   **auto-saved** as you work (it exists as a draft from the moment you start),
   reopens into the same builder for editing, is **independently deletable into a
   restorable trash** (new — today a report only vanishes via job CASCADE), is
   attributed to the **actual creating user** with a "Prepared by {name}" line
   (today every row is the literal string `'Eric'`; the preparer line was dropped
   in ADR 0003's cleanup), is **numbered per Job** (Report #1, #2, …), and
   carries an **editable report date**.

4. **Photo Report templates are kept and upgraded.** They now carry **boilerplate
   write-up text** per section (not just headings), seeding a new report you then
   edit. They live in Settings now that the global Reports area is gone, ship a
   couple of sensible defaults (incl. Findings / Work Performed), and the term
   **"Photo Report template"** is canonical — the older "preset" UI wording
   retires. The PDF's global photos-per-page knob (ADR 0003 amendment,
   `company_settings.report_photos_per_page`) is **retained** for the photo pages.

5. **Photos in the PDF get a more pronounced corner radius** (today's radius is
   already rounded but subtle), pulled into one shared constant.

## Consequences

- This **reverses ADR 0003's "single minimal layout / same audience" rationale**
  for section content, and re-grows the layout/editor/PDF surface area ADR 0003
  deliberately shrank. Accepted because the minimal layout could not carry the
  findings/work-performed narrative the business actually writes.
- **Data-shape change** requiring a migration: the `photo_reports.sections` JSONB
  element gains a rich-text `body`; new columns for per-job `report_number`,
  `deleted_at` (soft-delete), an editable `report_date`, and real
  user/preparer attribution. Old rows must be read-tolerant (a missing `body`
  reads as empty).
- `@react-pdf/renderer` does not render HTML, so a **rich-text → PDF-primitives
  mapping** (paragraphs, bullet/numbered lists) must be built — the main new
  engineering in the PDF generator.
- The one-page cap is a **character limit, not pixel-exact** — the on-screen
  editor and the PDF engine render differently, so the cap is tuned
  conservatively rather than measured live.
- Cleanup opportunity: ADR 0003 left `photo_report_templates.cover_page` /
  `photos_per_page` and `photos.thumbnail_path` (ADR 0008) as dead-but-undropped
  columns; this rework's migration is the natural place to finally drop them.
- Existing generated PDFs in the `reports` bucket are not regenerated; they keep
  their old layout as a historical record (consistent with ADR 0003).

## Considered options

- **Keep ADR 0003's minimal layout, only move creation in-job.** Rejected: it
  ignores the actual driver — the reports need narrative, not just a tidier
  create flow.
- **Plain multi-line text instead of rich text.** Rejected: the business
  specifically writes bullet-point lists, which plain text can't format.
- **Interleave prose with photos, or one executive summary up front.** Rejected
  in favor of a per-section intro page: it reuses the existing divider page,
  reads cleanly ("here's what we found" → photo evidence), and avoids the much
  harder flowing-layout work.
- **Auto-shrink text, or a visual page-fill meter, to enforce one page.**
  Rejected for a predictable character-limit-with-counter; auto-shrink risks
  unreadably small text and a live meter still can't guarantee PDF fit.
- **A dedicated "Reports" job tab.** Rejected by the owner in favor of
  create-from-Photos + manage-in-Overview, avoiding a fourth job tab.
- **Keep the global `/reports` page as a read-only cross-job index.** Rejected in
  favor of fully committing to the in-job model.
