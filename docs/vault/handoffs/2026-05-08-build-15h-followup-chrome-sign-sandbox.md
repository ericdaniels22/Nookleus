---
date: 2026-05-08
build_id: 15h-followup
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-08-build-15h-followup-ipad-pdf-access]]", "[[2026-05-07-build-15h]]", "[[build-15h]]"]
---

# Build 15h follow-up — Chrome `/sign/[token]` hang from email-iframe sandbox inheritance — 2026-05-08

## What shipped this session

- **One commit on `main` `1d548d3` → `d9f92ef`, pushed to `origin/main`.** Closes finding #4 (final 15h-deferred UX item) — Chrome rendering `/sign/[token]` as a stuck "Loading PDF…" shell while Safari rendered fine. Single-line fix at `src/components/email-reader.tsx:62`: `sandbox="allow-same-origin allow-popups"` → `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`. Live AAA-prod verification PASS via Eric clicking the contract link from the in-app `/email` inbox after Vercel deploy — verbatim "it worked". **All four 15h UX findings now closed.**

- **Diagnosis was the work; the fix was one token.** Initial hypothesis from Eric ("could it be that I was logged in on Chrome but not on Safari?") was checked and ruled out cleanly: `/sign/[token]` is in the proxy.ts public-page allowlist (`src/proxy.ts:48`), SSR uses `createServiceClient` not user session, the PDF fetch goes to a Supabase signed URL on a different origin so app-domain cookies don't follow, and the pdfjs worker is served from `_next/static/media/...` (matcher-exempt). Login state was not the differentiator. Pivot to cache vs SW vs popup-context investigation followed.

- **Repro discipline that nailed the cause.** Three-context comparison run live: (a) **incognito** w/ pasted URL → renders; (b) **MCP-controlled tab** in same regular Chrome profile via `mcp__claude-in-chrome__navigate` to the same URL → renders, with `navigator.serviceWorker.getRegistrations() = []`, `caches.keys() = []`, `pdfjs.GlobalWorkerOptions.workerSrc = "/_next/static/media/pdf.worker.min.0wghn0~9oxou6.mjs"`, zero console errors, PDF visible end-to-end. So the deployed code was healthy and the user's Chrome profile was healthy. (c) Eric opened a **brand-new** logged-in Chrome tab → went to `/email` → clicked the email body's "Open document" link → new tab still hung at "Loading PDF…", same 28× console error: "Blocked script execution because document's frame is sandboxed and the 'allow-scripts' permission is not set." The differentiator was the **navigation path**, not the URL or the cache.

- **Sandbox-inheritance signature locked it down.** The `/email` inbox renders email body HTML inside `<iframe sandbox="allow-same-origin allow-popups">` at `email-reader.tsx:59-64`, with `<base target="_blank">` injected at `:45` so every link opens in a new tab. Per the HTML spec, popups opened from a sandboxed iframe inherit the parent's sandbox flag set unless `allow-popups-to-escape-sandbox` is also granted. Inheritance carried `allow-scripts`'s absence into the new tab → React/Next/pdfjs scripts blocked at parse time → the page rendered the SSR shell (`AAA Disaster Recovery` header + `Loading PDF…` placeholder + audit footer) but never hydrated → no PDF fetch was ever attempted. Same exact 28× error signature 15e fixed for a different cause (pdf.js fake-worker fallback running inside its own sandboxed iframe), which is why the symptom looked familiar; the cause this time was upstream — the parent tab itself was sandboxed.

- **Fix.** Added `allow-popups-to-escape-sandbox` to the iframe sandbox token list. The flag intentionally does not also grant `allow-scripts` to the iframe itself — email-body scripts continue to be blocked (security-correct), only popups get a fresh, unsandboxed browsing context. Surface area is tiny; no callers of `<EmailBodyFrame>` other than the inbox reader, and no other iframes touched. `npx tsc --noEmit` clean. No build verified this session (single-token edit, no type or runtime risk; Vercel deploy auto-verified).

- **Smoke pattern: subagent-free, fully controller-driven via `mcp__claude-in-chrome__*`.** First MCP-tab navigation to the live `/sign/[token]` URL gave the workerSrc + SW + cache evidence in one batched `browser_batch` call (one `javascript_tool` + one `read_console_messages` + one `read_network_requests`). That single batch was decisive — it ruled out SW, ruled out cache mismatch, and confirmed the deployed worker URL was correct, leaving navigation-path inheritance as the only remaining hypothesis. No subagents used. Diagnose skill phases 1–6 followed cleanly.

- **Memorized the linkage so future sandbox-tightening doesn't re-break it.** Wrote project memory at `~/.claude/projects/.../memory/project_email_iframe_sandbox_popups.md` and added the index entry to `MEMORY.md`. The memory captures: which iframe (`src/components/email-reader.tsx`), why the flag is required (`<base target="_blank">` injects target on every link → popups inherit sandbox without escape flag), and that `allow-scripts` MUST stay omitted on the iframe itself (email bodies must not execute scripts).

## What's next

- **All four 15h UX findings now closed.** This session's commit closes the last one (Chrome `/sign/[token]` hang). The build-15h carry-over UX list is exhausted; no further 15h-tagged work remains.

- **Pre-existing 15h carry-over still open.** Schema follow-up — relax `contracts.filled_content_html` NOT NULL — unchanged. The `/api/settings/contract-templates/[id]/duplicate/route.ts:35` Bug-2-candidate dupe-name vulnerability is unchanged. Neither is regression-blocking; both are low-priority cleanup chips.

- **Optional polish from prior 15h-followup session.** `<DownloadPdfButton>` lacks a visible spinner during the blob fetch (sets `aria-busy` but no UI feedback), and uses `console.error` + last-ditch `window.location.href` instead of a toast on non-Abort failures. Still non-blocking.

## Decisions locked

- **Fix at the iframe sandbox attribute, not the popup target page.** Considered alternatives — adding `Cross-Origin-Opener-Policy: same-origin` headers to `/sign/[token]`, or having the page detect a sandboxed parent and reload itself top-level. Both add complexity at the wrong layer. The fix belongs where the missing sandbox flag is, in the parent iframe; it's narrower, has zero blast radius beyond the inbox, and the standard `allow-popups-to-escape-sandbox` flag exists exactly for this scenario. Explicitly preserves `allow-scripts` omission on the iframe — that omission is correct for security and was never the bug.

- **Customer impact is real but narrow, not catastrophic.** This affected any customer whose email client renders the email body inside a sandboxed iframe (Gmail web, Outlook web, the in-app `/email` inbox). Native mail clients (Apple Mail, Outlook desktop, mobile mail apps) don't sandbox the rendered body, so most real-world signing flows would not have hit this. Eric was the most likely victim because the AAA platform's own `/email` inbox is the primary sandboxed surface he uses, and he previews his own outgoing contract emails from inside it. Worth fixing immediately rather than waiting; deploy was a single-line web-only change.

- **No native iPad TestFlight rebuild needed.** Web-only fix; Capacitor's `server.url = https://aaaplatform.vercel.app` live-bundle pattern means iPad picks up the new code on next launch. Not exercised this session because the bug was Chrome-specific.

## Open threads

- **`<DownloadPdfButton>` polish from previous session.** Visible spinner during blob fetch + error toast instead of `console.error`. Carried over unchanged from `[[2026-05-08-build-15h-followup-ipad-pdf-access]]`.

- **Schema relax of `contracts.filled_content_html` NOT NULL.** Long-standing carry-over from build 15d era. Not blocking any current flow but the schema constraint is a vestige of the pre-15d Tiptap content shape; safe to relax when convenient.

- **Duplicate-route dupe-name handling.** `/api/settings/contract-templates/[id]/duplicate/route.ts:35` carries the same Bug-2-candidate pattern that `POST /api/settings/contract-templates` had before `96eebeb` introduced `(N)` suffixing. Worth a one-line application of the same helper if/when someone touches this route.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `d9f92ef` (`fix(15h-followup): allow popups from email iframe to escape sandbox`)
- **Uncommitted changes:** none (gitignored `out/` only)
- **Migrations applied this session:** none
- **Deployed to Vercel:** yes — pushed to `origin/main` once this session (`1d548d3..d9f92ef`). Live verification PASS via Eric clicking the email link after deploy.
- **Commits this session:** 1 — `d9f92ef`. Diff: `src/components/email-reader.tsx` +1 / -1.

## Notes for next session

- **Pattern — sandbox-inheritance bugs look like script execution / pdfjs bugs.** The 28× "Blocked script execution because document's frame is sandboxed" signature is identical to the 15e pdf.js fake-worker fallback signature, but the cause is the OPPOSITE: in 15e the **child** iframe (pdf.js's worker fallback) was sandboxed and we fixed it by switching to a real Web Worker; this time the **parent tab itself** was sandboxed via inheritance. When you see "frame is sandboxed" errors on a top-level tab and the script counts are high (one error per blocked script tag), check the navigation path — was this tab opened from a sandboxed iframe via `target="_blank"` without `allow-popups-to-escape-sandbox`? Fast triage: paste the URL into a fresh tab via address bar; if it renders, the problem is the path that opened it, not the destination page.

- **Pattern — three-context repro is decisive for sandbox / cache / SW questions.** Incognito-paste vs MCP-tab vs click-from-iframe in the same logged-in profile gave three orthogonal data points in one round-trip and ruled out four hypotheses (login state, disk cache, service worker, profile-level extension interference) at once. Worth reaching for whenever a bug "only happens in regular Chrome" — the goal is to find ONE working context and ONE failing context that differ in exactly one variable.

- **Pattern — controller-driven `mcp__claude-in-chrome__*` shines for diagnosis.** This session never spawned a subagent. The `tabs_context_mcp` + `navigate` + `browser_batch({javascript_tool, read_console_messages, read_network_requests})` flow gave the live workerSrc + SW + cache state in one shot. For diagnosis (vs implementation) it's faster and more legible than handing off to a subagent. The MCP tab opens in the user's actual Chrome profile so cache + cookies + extensions match — exactly what's needed for "it works for me but not for the user" investigations.

- **Lesson — when ruling out a user's hypothesis, list the falsifying evidence concisely first, then propose the next test.** Eric's "logged in on Chrome but not on Safari?" hypothesis was reasonable but wrong; the response that worked was a four-bullet list of why login state can't reach the rendering path (proxy allowlist, service-role SSR, cross-origin PDF fetch, matcher-exempt worker) followed by a concrete fallback hypothesis (cache/SW) and a one-action test (incognito). The bullets prevented "but what if…" looping and the fallback hypothesis kept momentum.

## Links

- Commit: `d9f92ef` `fix(15h-followup): allow popups from email iframe to escape sandbox`
- Memory: `~/.claude/projects/-Users-vanessavance-Desktop-aaa-platform/memory/project_email_iframe_sandbox_popups.md`
- Previous session (15h-followup ipad-pdf-access): [[2026-05-08-build-15h-followup-ipad-pdf-access]]
- Build 15h implementation: [[2026-05-07-build-15h]]
- Current state: [[00-NOW]]
