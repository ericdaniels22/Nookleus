# The in-app document viewer replaces the native PDF iframe on Estimate and Invoice Views

**Status:** Accepted — amends the #385 inline-PDF-View decision (rendering mechanism only). The #463 Chrome/Edge reliability go/no-go returned **GO** on 2026-06-06; the slice chain #464–#466 is unblocked.
**Date:** 2026-06-05 (accepted 2026-06-06)

## Reliability gate result (#463)

The throwaway spike (formerly `src/app/dev/viewer-spike/`, deleted after this run per the
note below) was driven against **real prod data** via a local `npm run dev`, using the
chrome-devtools / edge-devtools MCP to render the live Estimate `WTR-2026-0024-EST-8`
(4 pages) and Invoice `JOB-2026-0025-INV-1` (1 page) `/preview` PDFs in both browsers.

| Browser    | Estimate   | Invoice   | Range ON also OK? | Console |
| ---------- | ---------- | --------- | ----------------- | ------- |
| Chrome 148 | ✅ 4 pages  | ✅ 1 page  | ✅ (default)       | clean   |
| Edge 149   | ✅ 4 pages  | ✅ 1 page  | ✅ (default)       | clean   |

Both rendered in continuous fit-to-width scroll with **no "Loading PDF…" hang**, with the
recommended `disableStream + disableRange` on *and* with default Range/stream negotiation
on. pdf.js worker loaded `200`; `/preview` returned `200 application/pdf`,
`transfer-encoding: chunked`, **no `Accept-Ranges`** (criterion 7 — confirms the no-Range
condition the mitigation targets). Caveat: test PDFs were small (≤4 pages, ≤80 KB), so the
default-Range pass is not a stress test of the no-`Accept-Ranges` large-PDF stall; the
production viewer ships `disableStream:true, disableRange:true` (constraint 1 below)
regardless, sidestepping Range negotiation. Evidence gathered by Claude Code; decision
ratified by Eric Daniels, 2026-06-06.

> Incidental finding during the run: `node_modules/@react-pdf/renderer` was an empty
> directory (siblings intact), making `/preview` fail to compile with
> `Can't resolve '@react-pdf/renderer'` — likely the source of the known-red `@react-pdf`
> `tsc` errors. Repaired locally with `npm install @react-pdf/renderer@4.3.3`.

## Context

#385 made the Estimate/Invoice **View** surface show the real, customer-facing PDF
inline — byte-for-byte what the customer receives — rather than an HTML re-render of
the line items. The View is a **pure read**: the `/preview` routes call render-only
cores ([`render-and-upload.ts`](../../src/lib/pdf-renderer/render-and-upload.ts):
`renderEstimatePdfBuffer` / `renderInvoicePdfBuffer`) that produce the PDF buffer with
no Storage upload, and all line-item **editing stays in the builder**, reached via the
Edit link, never on the View. That intent is correct and stays.

The **mechanism** #385 chose is a bare browser `<iframe>` that streams the `/preview`
bytes ([`pdf-preview-frame.tsx`](../../src/components/documents/pdf-preview-frame.tsx)),
so the page picker the user sees is the **browser's native PDF chrome**. #457 reported
that picker eats ~half the viewer width; its thumbnail sidebar lives in cross-origin
browser shadow-DOM and cannot be sized from our CSS. There is no way to slim it without
owning the viewer. #463 is the gate that decides whether to own it.

Owning it means moving the customer-facing money documents onto the same `react-pdf`
(pdf.js) stack as the contracts signing viewer — which carried a reputation for
**hanging on the loading screen in Chrome while rendering in Safari**. Before
committing, that reputation had to be root-caused.

**Reliability finding — the root cause, written down for slice #464.** The Chrome hang
was *not* a react-pdf / pdf.js / worker defect. It was **email-iframe sandbox
inheritance**, diagnosed and fixed on 2026-05-08 (build 15h-followup, prod-verified —
see [`2026-05-08-build-15h-followup-chrome-sign-sandbox.md`](../vault/handoffs/2026-05-08-build-15h-followup-chrome-sign-sandbox.md)).
The in-app `/email` inbox renders the email body inside
`<iframe sandbox="allow-same-origin allow-popups">` with `<base target="_blank">`
injected, so a popup opened by clicking the contract link inherited the parent's
sandbox set — **minus `allow-scripts`** — into the new tab. React/pdf.js never
hydrated, the SSR shell sat on "Loading PDF…", and **no PDF fetch was ever attempted**
(signature: 28× "Blocked script execution because document's frame is sandboxed"). The
differentiator between hang and render was the **navigation path**, not the viewer; the
same diagnosis observed react-pdf rendering the PDF **end-to-end in Chrome** via direct
navigation (worker resolved from `_next/static`, zero console errors). The fix is a
single token — `allow-popups-to-escape-sandbox` — present today at
[`email-body-frame.tsx`](../../src/components/email/email-body-frame.tsx) (line 47).

What that means for an in-app Estimate/Invoice viewer: those Views are **top-level
authenticated pages**, never opened from the email iframe, so they were never exposed
to that bug, and the react-pdf stack is proven to render in Chrome on this deploy. The
reliability risk is therefore low — subject to three concrete constraints the new
viewer must honor (below).

## Decision

1. **Own the viewer.** Replace the native-iframe mechanism with an **in-app document
   viewer**: a `react-pdf` client island (dynamic `ssr: false`, mirroring the contracts
   [`signed-pdf-viewer.tsx`](../../src/components/contracts/signed-pdf-viewer.tsx)
   pattern and reusing [`configurePdfjs`](../../src/lib/pdf/configure-pdfjs.ts)) that
   renders the streamed `/preview` PDF in continuous vertical scroll, fit-to-width, with
   a slim **page picker** rail. Both Views flip together because they share one seam —
   [`PdfPreviewFrame`](../../src/components/documents/pdf-preview-frame.tsx) (`{ src, title }`).

2. **#385's intent is preserved exactly.** Byte-for-byte customer PDF from the same
   `/preview` routes; pure read, no Storage upload; read-only; editing stays in the
   builder. Only *how the bytes are painted* changes.

3. **Reliability constraints the in-app viewer must honor**, so it cannot inherit the
   gaps the contracts viewer left:
   - **Same-origin, no-Range byte stream.** The `/preview` routes return the whole
     buffer with `200` + `application/pdf` and **no `Accept-Ranges` / 206**
     (`src/app/api/estimates/[id]/preview/route.ts`,
     `src/app/api/invoices/[id]/preview/route.ts`; confirmed: no `Accept-Ranges`
     anywhere in `src/`). The viewer must pass
     `<Document options={{ disableStream: true, disableRange: true }}>` (or the routes
     must add real 206 support) so Chrome cannot stall on partial-content negotiation.
   - **Version-locked worker.** Source `GlobalWorkerOptions.workerSrc` from react-pdf's
     own bundled pdf.js so a future `^`-range bump of standalone `pdfjs-dist` cannot
     desync the worker build from the main-thread API (pdf.js stalls on version skew).
     Today both are 5.4.296, hoisted to one physical package.
   - **No sandboxed-iframe entry.** The viewer's entry points stay top-level,
     script-enabled contexts; never reachable via a `target="_blank"` popup from a
     sandboxed iframe without `allow-popups-to-escape-sandbox`.

4. **Presentation-only — ADR 0007 untouched.** This changes only how the View renders
   the customer PDF. It does not create invoices, change the Estimate→Invoice
   conversion, billing state, the "Invoiced" counting, or the no-edit-once-paid/voided
   guards. [ADR 0007](0007-estimates-are-the-single-billing-entry-point.md) (estimates
   are the single billing entry point) stands fully intact.

## Consequences

- **Reverses #385's native-iframe mechanism** while keeping its intent. Both consumers
  convert at once through the shared frame: the Estimate View Server Component
  (`src/app/estimates/[id]/page.tsx`) and the Invoice read-only View Client Component
  ([`invoice-read-only-client.tsx`](../../src/components/invoices/invoice-read-only-client.tsx)).
- **We now own the viewer chrome.** Download was previously available from the native
  toolbar; it must remain reachable via the existing **Export PDF** action, since the
  native download button goes away.
- **This ADR gates the slice chain:** #464 (viewer swap), #465 (slim page picker — the
  actual fix for #457's width complaint), #466 (scroll-spy + page-picker reducer). The
  throwaway reliability spike under `src/app/dev/viewer-spike/` is **evidence only** and
  is deleted, not merged into the production viewer.
- **The contracts signing viewer is left as-is** (a separate surface); this ADR governs
  only the Estimate/Invoice View surface.

## Considered options

- **Own the in-app viewer (chosen).** The only option that lets us slim the page picker
  (#457) and control the layout, now that the Chrome-hang scare is shown to be an
  unrelated, already-fixed sandbox bug rather than a stack incompatibility.
- **Option A — keep the native viewer, only suppress its chrome (the fallback).** Pass
  `#toolbar=0` / `#navpanes=0` / `pageMode` fragments to the iframe to *hide* (never
  resize — the width isn't ours to set) the native rail. Recorded as the fallback **if
  and only if** the spike shows the react-pdf stack cannot be made reliable in Chrome
  **and** Edge on Windows. Rejected as the primary because it cannot deliver a slim,
  app-styled page picker and fragment support is browser-inconsistent. Under this
  fallback, slices #464–#466 are revised or dropped.
- **Keep the native iframe unchanged.** Rejected: it is exactly what #457 complained
  about — the picker eats ~half the width and we cannot touch it.

See the **page picker**, **in-app document viewer**, and **native document viewer**
entries in the [glossary](../vault/00-glossary.md).
