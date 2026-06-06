# Viewer reliability spike — #463 (THROWAWAY)

This route is **evidence, not product**. It exists to settle the #463 go/no-go:
can the `react-pdf` (pdf.js) in-app document viewer render the **real customer
Estimate and Invoice `/preview` PDFs** reliably in **Chrome and Edge on Windows**?
Delete this whole folder (`src/app/dev/viewer-spike/`) once the decision below is
recorded. It is prod-guarded (`notFound()` in production), so it cannot ship.

The production viewer is **slice #464**, built per [ADR 0012](../../../../docs/adr/0012-in-app-document-viewer-replaces-native-pdf-iframe.md).

## Why this spike is small

The scary premise — "the contracts react-pdf viewer hangs in Chrome" — was already
root-caused and fixed. It was **not** a react-pdf / pdf.js / worker problem. It was
**email-iframe sandbox inheritance**: opening the contract link from inside the
`/email` inbox's `sandbox="allow-same-origin allow-popups"` iframe (with
`<base target="_blank">`) spawned a popup that inherited the missing `allow-scripts`,
so the new tab never ran React/pdf.js and sat on "Loading PDF…". Fixed 2026-05-08 with
one token — `allow-popups-to-escape-sandbox` — present today at
`src/components/email/email-body-frame.tsx:47`. During that diagnosis react-pdf was
observed rendering the PDF **end-to-end in Chrome** via direct navigation.

The Estimate/Invoice Views are **top-level authenticated pages**, never opened from the
email iframe, so they were never exposed to that bug. The only genuine residual is that
the `/preview` routes stream the whole buffer with **no `Accept-Ranges`/206**, so Chrome
*could* stall on Range negotiation for a large PDF — which the `disableStream` +
`disableRange` toggle in this spike exists to confirm.

## Prerequisites

1. Logged in to the app locally (auth is cookie-based; the `/preview` routes are
   permission-gated — `view_estimates` / `view_invoices`).
2. Your active org has a **default `pdf_preset`** seeded for both `estimate` and
   `invoice` (otherwise the route returns `400`).
3. One **estimate id** and one **invoice id** that belong to your org — copy the UUID
   straight out of an `/estimates/<id>` and an `/invoices/<id>` URL.

## Run it

```
npm run dev          # from this worktree (node_modules is junctioned to main)
```

Then, **in Chrome and again in Edge**, open:

```
http://localhost:3000/dev/viewer-spike
```

Paste the estimate id and invoice id, press **Load**. Leave the
`disableStream + disableRange` box **ticked** (the recommended config) for the primary
check; untick it and press **Load** again to compare the default Range-negotiating
behavior, especially on a large multi-page PDF.

### What "pass" looks like

- Both viewers reach `✅ rendered N pages` and show the PDF in continuous vertical
  scroll, fit-to-width — **no permanent "Loading PDF…"** hang, in **both** browsers.
- An `❌` status with a message is a real failure — note the message and the browser's
  DevTools → Network tab (the worker request should be `200` with a JS MIME, and the
  `/preview` request should return the PDF, not a `401/403/400`).

## Go / no-go record (criterion 7 — fill this in)

| Browser | Estimate renders? | Invoice renders? | Range ON also OK? | Notes |
| ------- | ----------------- | ---------------- | ----------------- | ----- |
| Chrome  |                   |                  |                   |       |
| Edge    |                   |                  |                   |       |

**Decision:** ☐ GO (own the viewer — proceed with #464–#466) &nbsp; ☐ NO-GO (Option A
native-suppression fallback — revise/drop #464–#466 per ADR 0012)

**Decided by / date:** ______________________

> After recording the decision: flip [ADR 0012](../../../../docs/adr/0012-in-app-document-viewer-replaces-native-pdf-iframe.md)
> `Status:` from **Proposed** to **Accepted** (on GO) and delete this folder.
