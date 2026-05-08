---
date: 2026-05-08
build_id: nookleus-platform-chrome
session_type: focused
machine: TheLaunchPad
related: ["[[build-65a]]", "[[build-18a]]", "[[build-18c]]"]
---

# Nookleus Platform Chrome Handoff — 2026-05-08

## What shipped this session

- **PR #46 merged to main as squash commit `2cfda55` "feat: rebrand platform chrome to Nookleus (#46)".** Web prod deploy SUCCESS at `aaaplatform.vercel.app` (Vercel build status via GitHub commit-statuses API). Closes the months-old web-rebrand thread that started at [[build-18a]] briefing's "rebrand UI/copy/docs lands in 18c" and shipped iOS-side at [[build-65a]] but stalled on web pending a domain decision.

- **Pre-merge work (resumption of branch from 2026-04-30):**
  - Asset bundle dropped into `public/`: `favicon.ico`, `nookleus-icon-{16,32,192}.png`, `nookleus-icon.png` (512), `nookleus-lockup.png` (480w canonical), `nookleus-lockup-240w.png`, `nookleus-lockup-720w.png`, `manifest.webmanifest`.
  - `src/app/layout.tsx`: replaced metadata block with Nookleus title-template + icon set + manifest link.
  - `src/app/login/page.tsx`: swapped `/logo.png` → `/nookleus-lockup.png`, copy "Sign in to Nookleus", footer "Nookleus".
  - `src/components/nav.tsx`: added subtle Nookleus mark (h-6 opacity-90) above the workspace logo area in expanded mode; replaced "AAA Platform v1.0" fallback string with "Nookleus".
  - `src/app/error.tsx` + `src/app/not-found.tsx`: new files using Next 16.2.0 `unstable_retry` signature (NOT `reset` — verified against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
  - `src/proxy.ts`: matcher-exception added for `manifest.webmanifest` so the new PWA manifest isn't auth-redirected to `/login` HTML.
  - Stray "AAA Platform" copy → "Nookleus" in `src/app/(public)/sign/[token]/page.tsx` (signing-attribution footer), `src/app/settings/accounting/setup/setup-wizard-client.tsx` (dry-run blurb), `src/app/settings/accounting/accounting-settings-client.tsx` (QB connect blurb).
  - `package.json` + `package-lock.json`: name field `aaa-platform` → `nookleus`.

- **Eric's screenshot caught a bug in the v1 push:** Test Company workspace was rendering AAA's logo in the sidebar. Root cause: `src/components/nav.tsx` hardcoded `/logo.png` and "AAA" badge text — the workplan's "leave alone — already pulls from `company_settings.logo_path`" assumption was wrong; the sidebar logo had never been wired to tenant data. Fix `6fd14cd` adds a `useEffect` in `nav.tsx` that fetches `/api/settings/company` (RLS-scoped to active org via build-18b enforcement) and computes `logoUrl` from `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-assets/${logo_path}` + `companyInitials` from `company_name`. Three render sites updated: mobile top bar, collapsed-mode badge (renders initials instead of literal "AAA"), expanded-mode logo area. Uses `unoptimized` on the dynamic `<Image>` since `next.config.ts` has no `images.remotePatterns` for the Supabase domain. AAA workspace keeps its uploaded logo iff `company_settings.logo_path` is set; falls back to `company_name` text + initials if not.

- **Conflict resolution during merge from main → branch (3 conflicts, plus 1 auto-merge worth flagging):**
  - `src/proxy.ts`: combined both matcher additions (mine `manifest.webmanifest` + main's `pdf.worker.min.mjs` from 15e); single regex with the pdf.js worker comment retained + extended.
  - `src/components/invoices/invoice-detail-client.tsx`: modify/delete — accepted main's delete (file retired in the build-67 invoices refactor; my "AAA Platform" → "Nookleus" string edit became moot).
  - `package.json` + `package-lock.json`: auto-merged; `"nookleus"` name preserved alongside main's new `@tiptap/extension-document/paragraph/text/history`, `react-pdf`, `uuid`, `@types/uuid` deps.
  - `src/app/(public)/sign/[token]/page.tsx`: auto-merged. The page got refactored on main into `HeaderBlock` + `ErrorShell` + `SignedShell` components; the "Secure signing powered by Nookleus" string landed cleanly in `HeaderBlock`.
  - Merge commit `056d524` on the branch; squashed away by GitHub's Squash and Merge into `2cfda55` on main.

## What's next

- **Workplan Step 5 (Supabase dashboard) — Eric's manual work.** Authentication → Email Templates → update Confirm signup, Magic Link, Reset Password, Invite user templates: replace any "AAA Platform" / "AAA Disaster Recovery" with "Nookleus", add the Nookleus lockup at the top via inline HTML (URL: `https://aaaplatform.vercel.app/nookleus-lockup-240w.png`). Authentication → Email Templates → Sender details: set sender name to "Nookleus"; leave sender email at the Supabase default until `nookleus.com` (or similar) is provisioned — do NOT route platform-auth mail through `@aaacontracting.com` (that's AAA tenant identity, not Nookleus platform identity).

- **iOS CI build failure on `2cfda55`.** The squash-merge to main triggered an App Store Connect CI run (build `11b1810d-7faf-4422-8cb7-a1147ecd6a12`) that errored. Separate from the web rebrand (iOS already shipped as Nookleus via [[build-65a]] build 3). Likely an iOS signing/CI config issue that needs a Mac session to triage. Web prod deploy is unaffected.

- **Workplan deferred (low priority, not blocking):** SVG vector versions of the Nookleus assets (raster bundle is shipped; SVG is polish), GitHub repo rename `aaa-platform` → `nookleus`, production-domain migration to `nookleus.app`, README cosmetic rewrite (current README is stock create-next-app text + env-var docs, no AAA branding to swap).

## Decisions locked

- Branch named `nookleus-platform-chrome` (Eric: "Name it" → I proposed the slug, he confirmed by saying "go").
- Single squashable commit shape (Eric: "one squashable commit").
- `package.json` rename to `"nookleus"` is included (Eric: "What ever you recommend" + "go" — recommended yes).
- Push the branch + open PR #46 immediately (Eric: "Make this go live in vercel so i can see changes").
- Push the merge commit after resolving conflicts (Eric: "lets push").
- Squash-merge PR #46 to main (Eric: "do it").

## Open threads

- **AAA workspace logo dependency on `company_settings.logo_path`.** The new dynamic sidebar logo renders AAA's logo IFF AAA has `logo_path` set in `company_settings`. If not, AAA users see "AAA Disaster Recovery" text + "ADR" initials in the collapsed-mode badge (regression vs the previous hardcoded `/logo.png`). Fix on Eric's side is to upload AAA's logo via Settings → Company once if it isn't already there. Verifying this is open.
- **Sidebar Nookleus mark visual sanity-check.** Currently `h-6 w-auto opacity-90` on `/nookleus-lockup-240w.png`. Live-rendered fine on the Vercel preview during the session. If it feels too small/big/loud against the dark sidebar gradient at production-resolution, the className is the only knob to turn.
- **Collapsed-mode badge for AAA changed from "AAA" → "ADR".** The new initials-from-`company_name` algorithm produces "ADR" from "AAA Disaster Recovery". If Eric wants AAA to keep saying "AAA" specifically (preserve the existing 3-letter brand mark), special-case orgs whose first word is all-uppercase to use the first word verbatim — say the word and I'll patch.

## Mechanical state

- **Branch:** `nookleus-platform-chrome` on the worktree at `.claude/worktrees/angry-jackson-649619/` (still alive locally; merged into main via squash, retain-or-delete per Eric's branch-retention pattern).
- **Commit at session end:** `056d524` (the local merge commit on the branch) — but the canonical "what landed" is `2cfda55` on `origin/main` (the GitHub squash-merge of PR #46).
- **Uncommitted changes:** none in the worktree. Vault handoff edits + 00-NOW updates pending in this session are the only things uncommitted at handoff-write time.
- **Migrations applied this session:** none. Pure chrome rebrand, no schema changes.
- **Deployed to Vercel:** yes — preview during PR (Eric verified the chrome + the sidebar fix on the preview URL `aaaplatform-git-nookleus-...`); production after squash to main, build status SUCCESS via GitHub commit-statuses API.

## Notes for next session

- **The workplan's `/nookleus-lockup-480w.png` references in code samples were inconsistent with its asset list, which said to rename that file to `nookleus-lockup.png` (canonical).** First push had three broken-image references (login, not-found, error) — caught when the lockup rendered as a broken-image icon on the live preview. All three references now point to `/nookleus-lockup.png`. The `-240w.png` and `-720w.png` raster sizes also exist for `<img srcset>` use cases (not currently used; the sidebar Nookleus mark uses `-240w` directly).
- **The workplan's "leave alone — sidebar logo already pulls from `company_settings.logo_path`" note was wrong.** The sidebar logo was hardcoded `/logo.png`; it had never been wired to tenant data despite the [[build-18a]] briefing implying otherwise. Generic lesson: workplan rows of the form "leave alone — already wired to X" should get a one-line code-read verification before the rebrand starts. If the workplan had said "wire the sidebar logo to `company_settings.logo_path`" as an explicit step, the screenshot-debugging round trip would have been avoided.
- **The Nookleus mark placement** went into `nav.tsx` (sidebar TOP, above the workspace logo) instead of `workspace-switcher.tsx` per the literal workplan instruction. The workspace switcher actually sits in the lower-middle of the sidebar (build-65 locked layout, "the switcher lives in the sidebar above the user footer, not viewport-fixed"), not at the top — putting platform identity there would have been visually wrong. The mark is at the actual sidebar top, matching the workplan's described intent ("above the active workspace name") given the real layout. Solo-tenant users see it too, which is what brand cohesion requires.
- **Platform-vs-tenant identity is now cleanly separated in the chrome.** Nookleus = platform (favicon, tab title, login, sidebar Nookleus mark, 404, error). Tenant = workspace logo + name (sidebar logo area, contracts, /sign, /pay, AAA email signatures, contract templates). When AAA's `logo_path` is set, AAA users see "Nookleus" subtle at the top + "AAA Disaster Recovery" workspace logo prominent below.
- **iOS CI failure analysis was not done this session.** Eric explicitly framed the rebrand as web-only ("make this go live in vercel"); the iOS CI failure is a known-unrelated thread to triage in a Mac session. It looks like signing or `cap sync` config — same area as the open `Info.plist` permission-descriptions thread + the `b388106` `Package.swift` strip thread.
- **Worktree-side `.env.local` was copied during the earlier verification step** and removed before push (security hygiene — don't leave prod creds in a Claude worktree). Worktree-side `.claude/launch.json` had `autoPort: true` added so preview_start could pick a free port when 3000 was occupied; that file is gitignored, change is local to the worktree.

## Links

- PR: [#46](https://github.com/ericdaniels22/aaa-platform/pull/46)
- Squash commit on main: `2cfda55`
- Branch: `nookleus-platform-chrome` (worktree-merged, retain-or-delete)
- Current state: [[00-NOW]]
- Related: [[build-65a]] (iOS Nookleus rename), [[build-18a]] (workspace-switcher framing — "rebrand UI/copy/docs lands in 18c"), [[build-18c]] (workspace switcher implementation).
