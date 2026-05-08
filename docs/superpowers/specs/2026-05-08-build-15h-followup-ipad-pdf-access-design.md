---
date: 2026-05-08
build_id: 15h-followup-2
status: design
related: ["[[2026-05-07-build-15h-followup-signing-link-anchor]]", "[[2026-05-07-build-15h-post-sign-confirmation-emails-design]]"]
---

# Build 15h follow-up — iPad PWA signed-PDF access (View + Download)

## Context

Build 15h shipped post-sign confirmation emails and orphan deletion. The
session-end handoff filed four UX findings for a future 15-series cleanup.
This spec closes findings #2 and #3, both of which trace to the same root
cause: when the AAA platform is installed as a PWA on Eric's iPad
(Add-to-Home-Screen), `target="_blank"` PDF links pop out of the PWA into
Safari, which has its own cookie jar separate from the standalone PWA. The
Supabase session cookies set by `auth.getUser()` only live in the PWA jar,
so the request to `/api/contracts/[id]/pdf` hits the auth gate and returns
401. The "Download PDF" button is the same `<a href>` and lands the user in
Safari's PDF inline viewer with no app-back chrome and no save action — a
dead-end.

The auth-gated route itself (`src/app/api/contracts/[id]/pdf/route.ts`)
isn't broken; the call sites are wrong for PWA mode.

## Goals

1. Tapping **"View PDF"** on the post-sign success screen or on a contracts
   list (job page) renders the signed PDF inline **inside the PWA**, with a
   Back button. No Safari trip, no 401.
2. Tapping **"Download PDF"** saves the PDF straight to iPad Files / Downloads
   with no inline preview detour.
3. Same fix is applied to every staff-facing call site of the auth-gated
   PDF route, not just the post-sign success page.

## Non-goals

- Customer-facing `/sign/[token]` flow. That uses a public signing-token
  auth model (HS256 JWT, not Supabase session cookies); its surfaces are
  out of scope. Customers receive the signed PDF as an email attachment
  (build 15h customer_confirmation), so they have it.
- Other 15h carry-overs: finding #1 (clickable signing_link) shipped in
  the prior follow-up; finding #4 (Chrome `/sign` hang) is a separate
  pdfjs/react-pdf investigation.
- Cross-org isolation on the PDF route. The existing route does not scope
  by `organization_id`; consistent with prior behavior. Not changing here.

## Architecture

### New route: `/contracts/[id]/view`

A Next.js App Router server-component page that renders the signed PDF
inline. Auth-gated by `auth.getUser()` (redirect to
`/login?next=/contracts/[id]/view` on no session). Loads the contract row
via `createServiceClient()` and passes `/api/contracts/[id]/pdf?inline=1`
as the `pdfUrl` to a client component for actual rendering.

The page itself has:
- **Back link** (top-left): `/jobs/{job_id}` if present, else `/contracts`.
- **Header**: contract title and signed-at timestamp.
- **Download button** (top-right): `<a href="/api/contracts/[id]/pdf" download="{escaped_title}.pdf">` — same pattern as the new Download anchors elsewhere (see Download fix below).
- **Body**: `<SignedPdfViewer pdfUrl={...} />` — the new client component.

### New component: `<SignedPdfViewer>`

`src/components/contracts/signed-pdf-viewer.tsx`. ~50 lines. Calls
`configurePdfjs()` in `useEffect`, measures container width via
`ResizeObserver`, renders `<Document file={pdfUrl}>` with one `<Page>` per
page sized to fit the container. Loaded via `next/dynamic({ ssr: false })`
from the page (memory: react-pdf 10 SSR-crashes on module eval; existing
`PdfCanvas` usage at `contract-signer-view.tsx:12` follows the same pattern).

This is a separate component from `PdfCanvas` because `PdfCanvas` is
overlay-heavy — built for the editor and signer flows with required
`overlayFields` + `renderOverlay` props. A flat read-only viewer is
simpler and clearer as its own component.

### Server-side data load

```ts
const { data: contract } = await supabase
  .from("contracts")
  .select("id, title, status, signed_pdf_path, signed_at, job_id, void_reason")
  .eq("id", id)
  .maybeSingle();
```

Branches:
- Contract not found → "Contract not found" card.
- `signed_pdf_path` null → "Contract has not been signed yet" card with
  a link back to the job.
- `status === "voided"` → render the viewer normally but with a "Voided ·
  {reason}" pill above the PDF (voided contracts keep their stamped PDF
  per `void/route.ts`).
- Otherwise → render the viewer.

## Call-site changes

### `src/app/contracts/[id]/sign-in-person/complete/page.tsx`

Two swaps in the JSX block at lines 58-83:

1. View link (currently `<Link href="/api/contracts/[id]/pdf?inline=1" target="_blank">`)
   → `<Link href="/contracts/[id]/view">`. No `target`. In-app navigation.
2. Download `<a>` (currently `<a href="/api/contracts/[id]/pdf">`)
   → `<a href="/api/contracts/[id]/pdf" download="{escapedTitle}.pdf">`.

### `src/components/contracts/contracts-section.tsx:362-379`

The per-row View/Download buttons on the org-side contracts list have the
identical bug pattern. Same two swaps:

1. View `<Link href="/api/contracts/[id]/pdf?inline=1" target="_blank">`
   → `<Link href="/contracts/[id]/view">`.
2. Download `<a href="/api/contracts/[id]/pdf">`
   → `<a href="/api/contracts/[id]/pdf" download="{escapedTitle}.pdf">`.

### Out of scope for changes

- The `/api/contracts/[id]/pdf` route itself (auth gate stays; behavior
  unchanged).
- Public `/sign/[token]` and the signing-side rendering (different auth model).

## Download attribute behavior

Adding `download="{escaped_title}.pdf"` to the anchor:

- **iOS Safari 16+ (regular tab)**: respects `download` for same-origin
  URLs; routes file to Files / Downloads with no inline preview.
- **iOS PWA standalone**: same behavior expected per WebKit docs.
- **Chrome / Firefox / desktop Safari**: standard download behavior.
- **Older browsers without `download` support**: the route's existing
  `Content-Disposition: attachment` header still triggers a download
  (route file at `pdf/route.ts:58-63`, unchanged).

The filename in the attribute is sanitized identically to the route's
existing `Content-Disposition` filename derivation (`[\\/:*?"<>|]` → `_`,
unicode dashes → `-`, smart quotes → ASCII). Helper extracted to
`src/lib/contracts/pdf-filename.ts` so both call sites share a single
implementation.

If live iPad PWA testing reveals that `download` is ignored in standalone
display mode (iOS WebKit historically had inconsistencies here), the
fallback is a small client-side handler: fetch PDF as Blob, call
`navigator.share({ files: [pdfFile] })` to surface the iOS Share Sheet
("Save to Files"). Filed as a follow-up only if the simple attribute
doesn't suffice.

## Edge cases

- **Direct nav to `/contracts/[id]/view` while logged out** → redirect to
  `/login?next=/contracts/[id]/view`; after login, lands back on the viewer.
- **Direct nav while signed but not member of the contract's org** → today
  the route renders anyway (no org isolation). Consistent with existing
  PDF route behavior. Not introducing a regression; not closing the gap.
- **Voided contract** → "Voided · {reason}" pill rendered above the PDF;
  download link still works (preserves access for record-keeping).
- **Stale signed_pdf_path / Storage object missing** → the embedded
  `<Document file={"/api/contracts/[id]/pdf?inline=1"}>` fetch will return
  500 from the route; `<Document onLoadError>` surfaces "Failed to load
  PDF". Same failure mode as the existing signer flow.

## Testing

No automated test runner in repo (matches prior 15-series convention).

Verify before merge:
- `npx tsc --noEmit` clean.
- `npm run build` passes.

Live smoke against AAA prod from Eric's iPad in PWA standalone mode:
1. From a recently-signed contract's success screen: tap **View PDF** →
   confirm the new viewer route renders inline, Back button returns to job.
2. Same screen: tap **Download PDF** → confirm file lands in iPad Files
   without the Safari inline-viewer detour.
3. From a job page's contracts list (any signed contract): tap **View** →
   in-app render. Tap **Download** → save to Files.
4. Confirm regression-free on desktop Chrome: View opens the in-app
   viewer page; Download saves with the right filename.

## Implementation surface summary

New files:
- `src/app/contracts/[id]/view/page.tsx` — server component, auth-gated.
- `src/components/contracts/signed-pdf-viewer.tsx` — client, react-pdf, dynamic-imported.
- `src/lib/contracts/pdf-filename.ts` — shared filename sanitizer.

Modified files:
- `src/app/contracts/[id]/sign-in-person/complete/page.tsx` — swap View link + add download attr.
- `src/components/contracts/contracts-section.tsx` — same two swaps in the per-row buttons.

Estimated diff: ~150 lines added, ~10 lines modified.

## Decisions locked

- **In-app viewer route over inline expand on the success page.** Same
  bug exists in the contracts list elsewhere; a reusable viewer route
  fixes both surfaces with one component. Inline expand would only fix
  the success page.
- **New `<SignedPdfViewer>` over reusing `PdfCanvas`.** `PdfCanvas` is
  built for editor/signer flows and requires overlay props. A flat viewer
  is clearer as its own component (~50 lines vs forcing empty overlays
  through the editor component).
- **`download` attribute over JS blob+share fallback.** Try the simple
  attribute first. iOS 16+ should respect it; if standalone-PWA testing
  shows otherwise, escalate to Share Sheet handler in a follow-up.
- **Don't change the `/api/contracts/[id]/pdf` route.** The route is
  correct as-is; the bug is at the call sites. Keeping the route stable
  preserves the existing org-side desktop flow and the auth model.
- **No org-isolation hardening in this build.** Mirrors current PDF route
  behavior; out of scope for the iPad UX fix. Flagged as a separable
  consideration.

## Open questions / followups

- If iPad PWA ignores `download` attribute → file a follow-up for the
  Share Sheet handler.
- Customer-side post-sign PDF access (the public `/sign/[token]` post-sign
  state) is not addressed here. If a future build wants in-app PDF access
  for customers using PWA-installed signing links, a separate token-scoped
  viewer would be needed.
