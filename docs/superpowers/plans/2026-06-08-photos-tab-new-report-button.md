# Always-visible "New report" button on the Photos tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible "New report" button to the Job Photos tab toolbar that starts a blank Photo Report, while keeping the existing select-photos → "Create report" flow that pre-fills the selection.

**Architecture:** One client component changes (`job-photos-tab.tsx`). The create-report handler is relaxed to take the photos to include as an explicit argument; the "Start from…" popover (Blank + Organization templates) is factored into one small local component reused by both entry points. No backend, API, or routing changes — `POST /api/jobs/[id]/reports` already creates a blank report from an empty `photoIds`.

**Tech Stack:** Next.js (App Router) client component, React state, Supabase JS client (RLS-scoped reads), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-08-photos-tab-new-report-button-design.md`

---

## File Structure

- **Modify** `src/components/job-photos-tab.tsx`
  - Relax `handleCreateReport(templateId, photoIds)` to take the photos explicitly (remove the empty-selection early return).
  - Add a `newReportMenuOpen` state for the toolbar button's own menu.
  - Add the **New report** toolbar button (between the view toggle and **Upload Photos**) plus its menu.
  - Extract the "Start from…" popover into a local `StartFromMenu` component and use it from both the toolbar button and the bulk-action bar.
- **Create** `src/components/job-photos-tab.test.tsx`
  - Behavioral tests driven through the DOM (the spec said "extend" this file, but no test file exists yet for this component — so we create it).

No other files change. `nav.test.tsx`'s no-standalone-`/reports` assertion is untouched because we add no route.

---

## Task 1: Add the failing tests

**Files:**
- Test: `src/components/job-photos-tab.test.tsx` (create)

- [ ] **Step 1: Write the failing test file**

Create `src/components/job-photos-tab.test.tsx` with exactly this content:

```tsx
// Issue: the only entry point to a Photo Report was the bulk-action bar's
// "Create report", which renders only after photos are selected — so with
// nothing selected there was no visible way to start a report. This adds an
// always-visible "New report" toolbar button that starts a blank report, while
// keeping the selection flow that pre-fills the chosen photos. These tests drive
// both paths through the DOM, mocking the Supabase client (photo + template
// reads), next/navigation, sonner, the upload modal, and global fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import React from "react";

import type { Photo } from "@/lib/types";

// Hoisted, per-test-configurable backing data for the mocked Supabase reads and
// a stable router.push spy (a fresh vi.fn() per useRouter call could not be
// asserted on).
const h = vi.hoisted(() => ({
  photos: [] as unknown[],
  templates: [] as unknown[],
  push: vi.fn(),
}));

// A chainable, awaitable stand-in for the Supabase query builder. Every method
// returns the same object; awaiting it (the component awaits `.range()` for
// photos and `.order()` for templates) resolves to the configured result.
vi.mock("@/lib/supabase", () => {
  const make = (result: unknown) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: () => q,
      gte: () => q,
      lte: () => q,
      in: () => q,
      update: () => q,
      then: (onF: (r: unknown) => unknown) => onF(result),
    };
    return q;
  };
  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === "photos") return make({ data: h.photos });
        if (table === "photo_report_templates")
          return make({ data: h.templates });
        return make({ data: null, error: null });
      },
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The upload modal is heavy and irrelevant here; stub it inert.
vi.mock("@/components/photo-upload", () => ({ default: () => null }));

import JobPhotosTab from "./job-photos-tab";

// jsdom has no IntersectionObserver (the tab uses one for infinite scroll).
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

function makePhoto(id: string): Photo {
  return {
    id,
    job_id: "job-1",
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    taken_by: "Eric Daniels",
    before_after_role: null,
    created_at: "2026-06-04T12:00:00Z",
  } as Photo;
}

function renderTab() {
  return render(
    <JobPhotosTab
      jobId="job-1"
      tags={[]}
      supabaseUrl="https://example.supabase.co"
      coverPhotoId={null}
      onPhotosAdded={() => {}}
      onPhotoUpdated={() => {}}
      onCoverPhotoChanged={() => {}}
      onSelectPhoto={() => {}}
    />,
  );
}

function reportsPostCall() {
  return fetchMock.mock.calls.find(
    (c) => c[0] === "/api/jobs/job-1/reports",
  );
}

describe("JobPhotosTab — New report entry point", () => {
  beforeEach(() => {
    h.photos = [];
    h.templates = [];
    h.push.mockClear();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ report: { id: "new-report-1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", IO);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an always-visible New report button even with no photos selected", async () => {
    renderTab();
    // The toolbar button is present before any selection…
    expect(
      await screen.findByRole("button", { name: /new report/i }),
    ).toBeTruthy();
    // …whereas the selection-only "Create report" is absent until photos are picked.
    expect(
      screen.queryByRole("button", { name: /create report/i }),
    ).toBeNull();
  });

  it("starts a blank report from the toolbar: POSTs empty photoIds and opens the builder", async () => {
    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.photoIds).toEqual([]);
    expect(body.templateId).toBeUndefined();
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });

  it("starts from a template via the toolbar: POSTs that templateId with empty photoIds", async () => {
    h.templates = [{ id: "tmpl-1", name: "Roof Inspection" }];
    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Roof Inspection"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.templateId).toBe("tmpl-1");
    expect(body.photoIds).toEqual([]);
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });

  it("still pre-fills the selected photos from the bulk bar's Create report", async () => {
    h.photos = [makePhoto("p1")];
    renderTab();

    // Right-click a photo to start a selection (a plain click opens the photo).
    const img = await screen.findByRole("img");
    act(() => {
      fireEvent.contextMenu(img);
    });

    // The bulk bar now offers "Create report"; open its menu and pick Blank.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /create report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.photoIds).toEqual(["p1"]);
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/job-photos-tab.test.tsx`
Expected: FAIL. The first test fails finding the "New report" button (it does not exist yet); the others fail at `getByText("Blank report")` / the missing button for the same reason.

---

## Task 2: Implement the feature

**Files:**
- Modify: `src/components/job-photos-tab.tsx`

Apply these five edits. They are interdependent (the file will not type-check until all are applied), so make all five before re-running the tests.

- [ ] **Step 1: Relax `handleCreateReport` to take photos explicitly**

Replace this block (the comment + the whole `handleCreateReport` function, currently around line 281):

```tsx
  // Create a Photo Report from the selected photos (#400, #405). Server-side so
  // the report is numbered per Job and stamped with the real preparer; an
  // optional template seeds its boilerplate Sections (the selected photos are
  // appended as a Photos section). On success we open the full-screen, Job-scoped
  // builder.
  const handleCreateReport = async (templateId: string | null = null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setReportMenuOpen(false);
    setCreatingReport(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoIds: ids,
          ...(templateId ? { templateId } : {}),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to create report.");
        setCreatingReport(false);
        return;
      }
      const { report } = (await res.json()) as { report: { id: string } };
      router.push(`/jobs/${jobId}/reports/${report.id}`);
    } catch {
      toast.error("Failed to create report.");
      setCreatingReport(false);
    }
  };
```

with:

```tsx
  // Create a Photo Report and open the full-screen, Job-scoped builder (#400,
  // #405). Server-side so the report is numbered per Job and stamped with the
  // real preparer; an optional template seeds its boilerplate Sections. The
  // caller passes the photos to include: the bulk bar passes the current
  // selection, the always-visible toolbar button passes none — a blank start the
  // user then fills from the builder's photo tray. An empty selection is a valid
  // blank report (the API treats photoIds as optional), so there is no early
  // return.
  const handleCreateReport = async (
    templateId: string | null,
    photoIds: string[],
  ) => {
    setReportMenuOpen(false);
    setNewReportMenuOpen(false);
    setCreatingReport(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoIds,
          ...(templateId ? { templateId } : {}),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to create report.");
        setCreatingReport(false);
        return;
      }
      const { report } = (await res.json()) as { report: { id: string } };
      router.push(`/jobs/${jobId}/reports/${report.id}`);
    } catch {
      toast.error("Failed to create report.");
      setCreatingReport(false);
    }
  };
```

- [ ] **Step 2: Add the `newReportMenuOpen` state**

Find this line (currently around line 76):

```tsx
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
```

Insert immediately after it:

```tsx
  // The always-visible "New report" toolbar button (separate from the bulk bar's
  // "Create report") has its own open state, so the two "Start from…" menus open
  // and close independently.
  const [newReportMenuOpen, setNewReportMenuOpen] = useState(false);
```

- [ ] **Step 3: Add the `StartFromMenu` local component**

At the very end of the file, after the closing `}` of the `JobPhotosTab` component function (currently the last line, around line 710), append:

```tsx

// The "Start from…" popover shared by the Photos tab's two report entry points:
// the always-visible "New report" toolbar button and the bulk bar's "Create
// report". Both list Blank + the Organization's templates; only the photos they
// seed differ (none vs the current selection), which the caller decides via
// `onPick`. Local to this file — two consumers, not a cross-module helper.
function StartFromMenu({
  templates,
  templatesLoaded,
  onPick,
}: {
  templates: PhotoReportTemplate[];
  templatesLoaded: boolean;
  onPick: (templateId: string | null) => void;
}) {
  return (
    <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[220px] z-50 text-foreground">
      <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
        Start from…
      </p>
      <button
        onClick={() => onPick(null)}
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
      >
        Blank report
      </button>
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
        >
          {t.name}
        </button>
      ))}
      {templatesLoaded && templates.length === 0 && (
        <p className="text-xs text-muted-foreground/60 px-2 py-1.5">
          No templates yet — add them in Settings → Photo Report Templates.
        </p>
      )}
    </div>
  );
}
```

(`PhotoReportTemplate` is already imported at the top of the file: `import { Photo, PhotoTag, PhotoReportTemplate } from "@/lib/types";`. `StartFromMenu` is a function declaration, so it is hoisted and usable from the JSX above it.)

- [ ] **Step 4: Add the "New report" toolbar button**

Find the view-toggle button and the Upload button in the filter bar (currently around lines 403–418):

```tsx
        {/* View toggle */}
        <button
          onClick={() => setViewSize((v) => (v === "compact" ? "comfortable" : "compact"))}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground hover:border-muted-foreground/40 transition-colors"
        >
          {viewSize === "compact" ? "Comfortable" : "Compact"}
        </button>

        {/* Upload */}
        <button
          onClick={() => setUploadOpen(true)}
          className="px-4 py-1.5 rounded-lg bg-[#2B5EA7] text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-[#234b8a] transition-colors"
        >
          <Plus size={14} />
          Upload Photos
        </button>
```

Insert the New report button between the two (after the view-toggle `</button>`, before the `{/* Upload */}` comment), so the block becomes:

```tsx
        {/* View toggle */}
        <button
          onClick={() => setViewSize((v) => (v === "compact" ? "comfortable" : "compact"))}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground hover:border-muted-foreground/40 transition-colors"
        >
          {viewSize === "compact" ? "Comfortable" : "Compact"}
        </button>

        {/* New report (always visible) — starts a blank report; the user adds
            photos from the builder's tray. The bulk bar's "Create report" is the
            way to seed a report with the currently selected photos. */}
        <div className="relative">
          <button
            onClick={() => {
              const next = !newReportMenuOpen;
              setNewReportMenuOpen(next);
              if (next) loadReportTemplates();
            }}
            disabled={creatingReport}
            className="px-4 py-1.5 rounded-lg border border-border bg-card text-sm font-semibold text-foreground flex items-center gap-1.5 hover:border-muted-foreground/40 transition-colors disabled:opacity-60"
          >
            <Plus size={14} />
            {creatingReport ? "Creating..." : "New report"}
          </button>
          {newReportMenuOpen && (
            <StartFromMenu
              templates={reportTemplates}
              templatesLoaded={templatesLoaded}
              onPick={(id) => handleCreateReport(id, [])}
            />
          )}
        </div>

        {/* Upload */}
        <button
          onClick={() => setUploadOpen(true)}
          className="px-4 py-1.5 rounded-lg bg-[#2B5EA7] text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-[#234b8a] transition-colors"
        >
          <Plus size={14} />
          Upload Photos
        </button>
```

- [ ] **Step 5: Rewire the bulk-action bar to use `StartFromMenu`**

Find the bulk bar's inline "Start from…" menu (currently around lines 474–501):

```tsx
            {reportMenuOpen && (
              <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[220px] z-50 text-foreground">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                  Start from…
                </p>
                <button
                  onClick={() => handleCreateReport(null)}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                >
                  Blank report
                </button>
                {reportTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleCreateReport(t.id)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                  >
                    {t.name}
                  </button>
                ))}
                {templatesLoaded && reportTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground/60 px-2 py-1.5">
                    No templates yet — add them in Settings → Photo Report
                    Templates.
                  </p>
                )}
              </div>
            )}
```

Replace the whole block with:

```tsx
            {reportMenuOpen && (
              <StartFromMenu
                templates={reportTemplates}
                templatesLoaded={templatesLoaded}
                onPick={(id) => handleCreateReport(id, Array.from(selectedIds))}
              />
            )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/job-photos-tab.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Type-check and lint the touched files**

Run: `npx tsc --noEmit`
Expected: No NEW errors mentioning `job-photos-tab.tsx` or `job-photos-tab.test.tsx`. (The suite is known-red on clean `main` — a cluster of unrelated PDF/`@react-pdf` and missing-module errors. Confirm none of them reference the two files you touched.)

Run: `npx eslint src/components/job-photos-tab.tsx src/components/job-photos-tab.test.tsx`
Expected: No NEW errors on the touched files. (The repo has a known repo-wide `react-hooks/set-state-in-effect` lint; confirm you introduced nothing new — e.g. unused imports, missing deps.)

- [ ] **Step 8: Commit**

First confirm the branch (this repo has concurrent sessions moving `main`/branches):

Run: `git branch --show-current`
Expected: `feat/photos-tab-new-report-button` (the branch the spec was committed on). If you are on `main`, create/switch to that branch first: `git switch -c feat/photos-tab-new-report-button` (or `git switch` if it already exists).

Stage only the two files you changed (do NOT `git add -A` — other sessions have unrelated unstaged changes like `CONTEXT.md`):

```bash
git add src/components/job-photos-tab.tsx src/components/job-photos-tab.test.tsx
git commit -m "feat(photos): always-visible \"New report\" button on the Photos tab" -m "The only way to start a Photo Report was the bulk-action bar's \"Create report\", which renders only after photos are selected — so with nothing selected there was no visible entry point. Add an always-visible \"New report\" toolbar button that starts a blank report (the user adds photos from the builder's tray), and keep the selection flow that pre-fills the chosen photos. Factor the shared \"Start from…\" menu into a local StartFromMenu. No backend change: the create API already treats photoIds as optional." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: one commit containing exactly the two files.

---

## Manual verification (optional, after the automated tests pass)

A quick human check that the wiring is right end to end:

1. Open any Job → **Photos** tab with **no photos selected**. Confirm a **New report** button sits in the toolbar next to **Upload Photos**.
2. Click it → the "Start from…" menu opens with **Blank report** (plus any Organization templates). Pick **Blank report** → you land in the report builder with an empty Photos section and can drag photos from the tray.
3. Go back, **select one or more photos** → the blue bar shows **Create report**. Use it → the builder opens with those photos pre-filled. Both entry points coexist and are clearly labelled.

---

## Self-Review

**Spec coverage:**
- Always-visible toolbar button beside Upload Photos → Task 2 Step 4. ✓
- Opens the same "Start from…" menu (Blank + templates, lazy-loaded) → Step 4 calls `loadReportTemplates()` on open and renders `StartFromMenu`. ✓
- Creates a report with no photos and navigates into the builder → `onPick={(id) => handleCreateReport(id, [])}` + existing `router.push`. ✓
- Ignores current selection on purpose → toolbar passes `[]`, never `selectedIds`. ✓
- Existing selection flow unchanged / still pre-fills → Task 2 Step 5 passes `Array.from(selectedIds)`; regression test in Task 1 asserts `["p1"]`. ✓
- Shared "Start from…" markup factored into one local piece → `StartFromMenu` (Step 3), used by both consumers (Steps 4, 5). ✓
- Secondary/outline styling with `+` icon → Step 4 uses `border border-border bg-card` + `<Plus />`. ✓
- No backend/nav/builder change → confirmed; only `job-photos-tab.tsx` + its test change. ✓
- Tests: New report renders with zero selection; Blank POSTs empty photoIds + routes; template POSTs templateId + empty photoIds; selection flow regression → all four in Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `handleCreateReport(templateId: string | null, photoIds: string[])` — both call sites (Step 4 `(id, [])`, Step 5 `(id, Array.from(selectedIds))`) match this two-arg signature. `StartFromMenu`'s `onPick: (templateId: string | null) => void` matches both `onPick` closures. `newReportMenuOpen`/`setNewReportMenuOpen` declared in Step 2, read in Step 4, set in Steps 1 & 4. `PhotoReportTemplate` already imported. ✓
