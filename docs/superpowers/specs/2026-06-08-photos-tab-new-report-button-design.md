# Always-visible "New report" button on the Photos tab

**Date:** 2026-06-08
**Status:** Approved design — ready for implementation plan
**Component:** `src/components/job-photos-tab.tsx`

## Problem

Today the only way to start a Photo Report is to open a Job, go to the Photos
tab, **select one or more photos**, and click **Create report** in the blue
bulk-action bar (`job-photos-tab.tsx:463`, rendered only when
`selectedIds.size > 0` at line 433). With nothing selected the button is absent
from the DOM, so users can't find any way to start a report. (The feature was
not dropped in a build — confirmed against current `main` and the
`nav.test.tsx:113-129` guard that forbids a standalone `/reports` route. Photo
Reports are in-Job only by design — ADR 0009, `CONTEXT.md`.)

We want a **discoverable, always-visible** entry point on the Photos tab.

## Design

Add a **New report** button to the Photos tab's top toolbar, beside the
existing **Upload Photos** button.

```
Photos tab toolbar:
 [date] [date] [Users ▾] [Tags ▾] ...... [Comfortable] [ New report ▾ ] [ + Upload Photos ]
                                                        ^ always visible (outline/secondary)
```

### Behavior

- **New report** (toolbar, always visible) opens the same "Start from…" menu the
  selection flow already uses: **Blank** plus the Organization's Photo Report
  templates (lazy-loaded on first open). Picking an option creates a report with
  **no photos** and navigates into the builder, where the user drags photos in
  from the existing photo tray (`photo-report-builder.tsx:421`).
- It **ignores any current photo selection on purpose** — it is the "start
  fresh" path. If photos are selected, the blue bar's **Create report** is the
  way to include them.
- **The existing selection flow is unchanged.** Select photos → blue bulk bar →
  **Create report** still pre-fills exactly those photos.

Net: two clear entry points.

| Button | Where | Visible when | Photos included |
|--------|-------|--------------|-----------------|
| **New report** | Photos toolbar | always | none (blank) |
| **Create report** | blue bulk bar | ≥1 photo selected | the selected photos |

The two are labelled differently ("New report" vs "Create report") so that when
both are on screen at once it is obvious which one carries the selection.

## Implementation notes

No backend change. `POST /api/jobs/[id]/reports` already treats `photoIds` as
optional and creates a blank report when none are given
(`reports/route.ts:76-82`).

1. **Relax `handleCreateReport`** (`job-photos-tab.tsx:286`). It currently does
   `const ids = Array.from(selectedIds); if (ids.length === 0) return;`. Change
   it to take the photo ids explicitly (e.g. `handleCreateReport(templateId,
   photoIds)`), so the toolbar button can pass `[]` (blank) and the bulk bar can
   pass `Array.from(selectedIds)`. Remove the empty-selection early return for
   the blank path.
2. **Toolbar button + menu.** Add the **New report** button to the filter/toolbar
   row (next to Upload Photos) with its own menu-open state. The templates list
   (`reportTemplates` / `loadReportTemplates`) is shared between both buttons.
   Factor the "Start from…" popover markup into one small local piece so it is
   not duplicated between the toolbar and the bulk bar (local to this file — two
   consumers, not a cross-module helper).
3. **Styling.** Toolbar button is a secondary/outline style (the blue primary is
   reserved for Upload Photos), with a `+` icon for parity.

## Testing

Extend `src/components/job-photos-tab.test.tsx`:

- New report button renders **with zero photos selected**.
- Clicking it opens the "Start from…" menu; choosing **Blank** POSTs to
  `/api/jobs/{id}/reports` with **no/empty `photoIds`** and routes to
  `/jobs/{id}/reports/{id}`.
- Choosing a template POSTs with that `templateId` and empty `photoIds`.
- The existing selection-bar flow still pre-fills the selected photo ids
  (regression guard).

No routing/nav changes, so `nav.test.tsx`'s no-standalone-`/reports` assertion
is unaffected.

## Out of scope

- A global/standalone reports area (explicitly forbidden — ADR 0009,
  `nav.test.tsx`).
- Any change to the builder, the create API, or report numbering.
- Mobile-specific entry points.
