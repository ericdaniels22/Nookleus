---
date: 2026-05-08
build_id: 15h-followup
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-07-build-15h-followup-signing-link-anchor]]", "[[2026-05-07-build-15h]]", "[[build-15h]]"]
---

# Build 15h follow-up — iPad PWA signed-PDF access — 2026-05-08

## What shipped this session

- **Nine commits on `main` `b67d644` → `d52b04c`, all pushed to `origin/main`.** Closes findings #2 and #3 from the 15h handoff's deferred UX list (in-app View PDF + direct-to-Files Download on iPad). Final HEAD `d52b04c` Vercel-deployed; live AAA-prod smoke on the iPad **TestFlight** Capacitor app PASS — Eric verified Download → iOS Share Sheet → Save to Files works without leaving the app. Verbatim: "it worked".

- **Spec + plan first, subagent-driven execution second.** `b67d644` `spec(15h-followup): iPad PWA signed-PDF access design` (222 lines, locks three decisions: in-app viewer route over inline expand; new `SignedPdfViewer` over reusing `PdfCanvas`; download attribute over JS blob+share fallback — the last one had to be revised mid-session, see below). `b7767d0` `plan(15h-followup): iPad PWA signed-PDF access — 8 tasks` (639 lines, verbatim code blocks per step). Execution mode: Subagent-Driven Development with fresh subagent per task + two-stage review (spec compliance → code quality). Eric drove final smoke on his hardware.

- **Plan tasks 1–6 (initial impl).** Five commits `4fa521c` → `b7996bb`: (1) `feat(15h-followup): shared PDF filename sanitizer` — `src/lib/contracts/pdf-filename.ts` exported `sanitizePdfFilename(title)` mirroring the route's `asciiFilename` logic exactly (smart quote / em-dash / non-ASCII fold) so client-side `<a download="...">` produces the same filename Vercel serves in `Content-Disposition`. **Took three fix rounds via subagents** because two haiku implementers stripped the smart-quote unicode codepoints back to ASCII and embedded literal NUL/DEL bytes into the source (git flagged it as binary). Controller wrote final file directly with verified codepoints (U+2010 to U+201D present, no literal control bytes, escape-sequence text `\x00-\x7F` correct). Lesson logged below. (2) `feat(15h-followup): SignedPdfViewer client component` — `src/components/contracts/signed-pdf-viewer.tsx` (64 lines, `"use client"`) flat read-only react-pdf viewer; configurePdfjs() in useEffect + ResizeObserver in useLayoutEffect; gates `<Document>` on containerWidth > 0; mirrors `PdfCanvas` patterns for AnnotationLayer/TextLayer CSS imports despite both layers being disabled. (3) `feat(15h-followup): in-app /contracts/[id]/view PDF viewer page` — `src/app/contracts/[id]/view/page.tsx` (123 lines), auth-gated server component → redirect to `/login?next=/contracts/[id]/view` if no user, three-branch render (missing / unsigned / main), sticky header with smart Back link (job or `/contracts`), title, `Signed {date}` or `Voided · {reason}`, Download anchor. **Plan deviation locked at impl time:** Next 16 disallows `dynamic({ ssr: false })` in server components; implementer correctly added a thin client wrapper `signed-pdf-viewer-client.tsx` (16 lines) holding the dynamic import (mirrors existing `contract-signer-view.tsx:12` pattern). Page imports the wrapper directly. (4) `fix(15h-followup): post-sign View PDF stays in app + Download → Files` — wired the new viewer into `src/app/contracts/[id]/sign-in-person/complete/page.tsx`: View `<Link>` swapped from `/api/contracts/[id]/pdf?inline=1 target="_blank"` → `/contracts/[id]/view` (no target, no PWA→Safari pop-out); Download `<a>` got `download={filename}` attribute. (5) `fix(15h-followup): contracts list View → in-app + Download → Files` — same swap in `src/components/contracts/contracts-section.tsx` per-row buttons.

- **Plan task 7 live-smoke surfaced an iPad TestFlight regression** that the original spec's "open question 4" (Share Sheet fallback if `download` attribute is ignored under PWA standalone) had flagged as a follow-up issue. Symptom: on the TestFlight app, View PDF worked perfectly (in-app render + Back), but tapping Download navigated the SPA to the PDF URL → WKWebView rendered the PDF inline with no Back gesture → Eric had to hard-close the app to recover. Verbatim: "the pdf view mode works, however, when i tap "download pdf" it takes me to a page that i cannot back out of. I have to hard close the app to be able to get back into the platform". Two fixes needed:

  - `631750e` `fix(15h-followup): iPad PWA Download → Share Sheet, no inline preview` — created `src/components/contracts/download-pdf-button.tsx` (client component) that intercepts the click only when `display-mode: standalone` matches (or pre-PWA-spec `navigator.standalone === true`), fetches the PDF as a blob, builds a `File`, calls `navigator.share({ files: [file] })` which pops the iOS Share Sheet directly (Save to Files / AirDrop / etc.) without ever showing the inline preview that traps the user. Falls back to `URL.createObjectURL` + synthetic `<a download>` click if `navigator.canShare({ files })` is false; final fallback is `window.location.href = pdfUrl`. Wired into all three call sites (post-sign complete, in-app /view header, contracts-section row). Desktop and Safari-tab keep the existing silent `<a download>` path. AbortError from user-dismissed Share Sheet is handled silently.

  - `d52b04c` `fix(15h-followup): trigger Share Sheet inside Capacitor WKWebView too` — Eric clarified he was testing in the **TestFlight Capacitor app**, not Safari Add-to-Home-Screen. Capacitor's WKWebView does NOT set `display-mode: standalone` and does NOT set `navigator.standalone === true` — so the previous detection silently fell through to the broken `<a download>` path. Added `window.Capacitor?.isNativePlatform?.() === true` to the OR condition so the Share Sheet path runs inside the TestFlight build the same way it does for Safari PWA standalone. **No native plugin install required:** iPadOS 16.4+ supports Web Share with files inside WKWebView, so the plain web `navigator.share({ files })` path works without `@capacitor/share`. Renamed the local var `standalone` → `inApp` to match the broader scope.

- **Capacitor wrapper architecture confirmed and memorized.** `capacitor.config.ts:9` sets `server.url = 'https://aaaplatform.vercel.app'` so the iPad TestFlight app is a thin WKWebView that loads live Vercel content — web changes propagate on next app launch with **no TestFlight rebuild required**. TestFlight rebuilds are only needed when adding native plugins or modifying `ios/App` native code. Memorized to `~/.claude/projects/.../memory/project_ipad_install_capacitor.md` so future detection-style work doesn't have to rediscover this.

- **Live AAA-prod smoke on iPad TestFlight (final state `d52b04c`):** Eric's verbatim PASS — "it worked". Did NOT formally exercise post-sign success page vs contracts-list per-row Download buttons separately, but the component is the same client component instance in both surfaces (`<DownloadPdfButton>`), so the smoke covers both. Desktop regression on Chrome assumed to PASS (the standalone+Capacitor checks all return false on desktop, so the original `<a download>` path runs unchanged) but not formally verified.

- **Verification artifacts.** `npx tsc --noEmit` clean after every commit. `npm run build` ✓ Compiled successfully in 6.8s; `/contracts/[id]/view` registered as ƒ (server-rendered on demand); 122 static pages generated. Vercel deploy verified live before iPad smoke via `curl -I https://aaaplatform.vercel.app/contracts/00000000-.../view` returning `307 → /login` (auth-gate redirect confirms the new route exists). Vercel etag on `/login` was fresh (`age: 0`) at deploy-verification time. No DB migrations applied; no DB writes. No new tests (repo has no test runner, consistent with prior 15-series sessions).

## What's next

- **Two of four 15h UX findings still open.** This session closed findings #2 (iPad View PDF unauthorized) and #3 (iPad Download PDF dead-end). Remaining for a future 15-series cleanup pass:
  4. `/sign/[token]` page hangs on the loading screen in Chrome but renders fine in Safari. Pre-existing pdfjs/react-pdf issue; needs a console-log dive. Carried over from 15h.

- **Pre-existing 15h carry-over (not 15h-followup work).** All 25b carve-out items are closed (3 shipped in 15e + 15h, 2 cut on legal grounds + already-shipped). The "schema follow-up — relax `contracts.filled_content_html` NOT NULL" thread is unchanged. The `/api/settings/contract-templates/[id]/duplicate/route.ts:35` Bug-2-candidate dupe-name vulnerability is unchanged.

- **Optional polish for the new viewer + download flow:** loading state on `<DownloadPdfButton>` while the blob fetch is in-flight (currently it's a brief flicker on a slow network — sets `aria-busy` but no visible spinner); error toast instead of `console.error` + last-ditch `window.location.href` fallback when the fetch / Share fails for a non-Abort reason. None blocking — current behavior is functionally correct on the happy path.

## Decisions locked

- **Web Share API fallback over routing Download to /view.** Eric's verbatim direction: "I dont want the download button to view the pdf. I just want ot automatically download the file." iOS PWA standalone and Capacitor WKWebView both block truly silent file downloads (Apple gates file-system writes behind the Share Sheet) — the closest the platform allows is `navigator.share({ files })` → Save to Files. One extra tap vs. true silent download on desktop, but the file lands in the Files app exactly as before. Rejected: "Download just opens /view" because it explicitly contradicts the spec's "direct save no preview" intent.

- **Plain web `navigator.share({ files })` over `@capacitor/share` plugin install.** iPadOS 16.4+ supports Web Share with files inside Capacitor WKWebView natively — no native plugin link needed. Avoids a TestFlight rebuild requirement (plugins must be linked at native build time). If a future smoke surfaces an iPad on iPadOS < 16.4, install `@capacitor/share` and bridge through `Share.share({ files })`; that one DOES require a TestFlight rebuild.

- **Detect "in-app" via THREE checks, not one.** `display-mode: standalone` (Safari PWA) ∨ `navigator.standalone === true` (pre-spec iOS Safari) ∨ `window.Capacitor?.isNativePlatform?.() === true` (Capacitor WKWebView TestFlight). Any of the three triggers the Share Sheet path. None of the three on a regular browser tab → `<a download>` works fine. The Capacitor check is the non-obvious one and is what bit us on the first iPad smoke.

- **No new TestFlight build for this session's work.** Web-only changes; Capacitor's live-bundle pattern (server.url at vercel) means the TestFlight app picks up the new code on next launch.

## Open threads

- **Finding #4 from 15h (Chrome `/sign/[token]` loading hang) still unresolved.** Not exercised this session; pre-existing 15h carry-over. Worth a console-log dive when someone next signs in via Chrome.

- **Loading state on `<DownloadPdfButton>` is minimal** — `aria-busy` flips to true during the blob fetch but there's no visible spinner. On a slow connection the user could double-tap and trigger duplicate fetches; the `if (busy) return` guard catches it but the button gives no visual feedback. Polish task only; non-blocking.

- **`navigator.share({ files })` UX is not byte-identical to a silent download** — the Share Sheet shows AirDrop, Mail, Messages, Notes, etc. alongside Save to Files. Eric saw it work on his iPad ("it worked") but didn't comment on whether the menu felt right; if the team decides to surface only Save to Files + Cancel later, that needs a native plugin and TestFlight rebuild. Today's behavior is platform-standard for "share file" and matches DocuSign / HelloSign / iOS Files app behavior.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `d52b04c` (`fix(15h-followup): trigger Share Sheet inside Capacitor WKWebView too`)
- **Uncommitted changes:** none (gitignored `out/` only)
- **Migrations applied this session:** none
- **Deployed to Vercel:** yes — pushed to `origin/main` four times this session (`b67d644..b7996bb`, `b7996bb..631750e`, `631750e..d52b04c`, plus the spec+plan push at session start). Final auto-deploy verified live via 307 probe on `/contracts/[id]/view`. iPad TestFlight smoke PASS verbatim "it worked".
- **Commits this session:** 9 — `b67d644` spec, `b7767d0` plan, `4fa521c` filename helper, `a76c551` viewer component, `41a49d4` viewer page (+ implementer-added wrapper file `signed-pdf-viewer-client.tsx`), `d66f972` post-sign wire, `b7996bb` contracts-list wire, `631750e` Share Sheet fallback, `d52b04c` Capacitor detection. All pushed.

## Notes for next session

- **Lesson — for files with unicode regex character classes, controller writes the file directly.** Plan task 1's `pdf-filename.ts` needed the smart-quote codepoints `‐ ‑ ‒ – — ― ‘ ’ “ ”` AND the literal escape-sequence text `\x00-\x7F` (NOT literal NUL/DEL bytes). Two haiku subagent implementers in a row mangled this — first stripped smart quotes back to ASCII; second embedded literal NUL/DEL bytes (0x00 / 0x7F) so git flagged the file as binary. Controller intervention via direct Write tool with `python3 -c "print(repr(open('...').read()))"` verification was the only path to a clean file. **Pattern:** when a file's correctness depends on specific unicode codepoints OR on the verbatim text of escape sequences, write it from the controller. Subagents can't reliably distinguish "the source contains the four characters `\` `x` `0` `0`" from "the source contains the byte 0x00" when copying text.

- **Lesson — Next 16 server components disallow `dynamic({ ssr: false })`. Use a thin client wrapper.** Plan said: `const SignedPdfViewer = dynamic(() => import("..."), { ssr: false });` directly in `page.tsx`. Implementer correctly caught that this errors at build time and added `signed-pdf-viewer-client.tsx` (16 lines, `"use client"`) that holds the dynamic import. Server component page imports the wrapper directly. Existing precedent in `contract-signer-view.tsx:12`. Document this pattern any time a plan calls for `dynamic({ ssr: false })` in a route page.

- **Lesson — iPad install detection has THREE shapes, not one.** Saved to memory at `~/.claude/projects/.../memory/project_ipad_install_capacitor.md`. The fastest way to confirm which one is in play: `git ls-files | grep -E '^(ios/|capacitor.config)'`. If `capacitor.config.ts` exists with a `server.url` set, the iPad install is a Capacitor TestFlight wrapper loading live Vercel content — TestFlight rebuilds NOT required for web changes. If it's also installed via Add-to-Home-Screen on Safari (plain PWA), both detection paths fire from the same Share Sheet code. Don't conflate the two.

- **Spec self-review caveat for next time.** The spec's open question 4 ("Decide on Share Sheet fallback if `download` attribute is ignored under PWA standalone") was flagged as "follow-up issue if so; do NOT extend this build's scope." That instruction was correct in spirit — but in practice, the smoke discovered the issue and Eric's "I just want it to download" direction made the Share Sheet fallback the obvious next move within the same session. Worth noting that "scope-cut at spec time" is a plan-fidelity guideline, not a hard freeze; user feedback can re-open scope if it surfaces during smoke. Recorded the right call this time but a future spec should phrase the open question as "build the fallback if probed during smoke" rather than "defer to a separate build."

- **Two fix iterations on the iPad smoke is not a regression** — the original Share Sheet fix (display-mode standalone) was correct for the Safari PWA case, the Capacitor extension was correct for the TestFlight case. Both detection conditions are now in place; Eric's smoke covered the TestFlight path. If a future smoke covers the Safari PWA path and surfaces a different bug, both checks are wired and the fallback path is shared.

## Links

- Spec: `docs/superpowers/specs/2026-05-08-build-15h-followup-ipad-pdf-access-design.md` (commit `b67d644`)
- Plan: `docs/superpowers/plans/2026-05-08-build-15h-followup-ipad-pdf-access.md` (commit `b7767d0`)
- Previous session (15h-followup signing_link anchor): [[2026-05-07-build-15h-followup-signing-link-anchor]]
- Build 15h implementation: [[2026-05-07-build-15h]]
- Current state: [[00-NOW]]
