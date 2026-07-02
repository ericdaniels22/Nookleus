# Nookleus Design System

This document is the single source of truth for all frontend work on Nookleus.
Every session that touches UI must read this file first and follow it exactly.
When existing code conflicts with this document, this document wins — migrate
the code.

**Design direction in one sentence:** a calm, dark, professional command
center — emerald is the product's voice, used sparingly; amber and red are
reserved for meaning; everything else is quiet neutral surfaces with strong
hierarchy.

**Decisions behind this doc** (read when the "why" matters):

- [ADR 0027](adr/0027-design-system-v2-dark-only-on-shadcn-token-slots.md) —
  dark-only, tokens mapped onto the shadcn slots
- [ADR 0022](adr/0022-job-status-labels-display-only-and-signed-contract-auto-advance.md) —
  job-status labels/colors are config-driven, display-only
- [ADR 0017](adr/0017-contract-emails-render-in-app-owned-branded-frame.md) —
  the Organization's identity leads on customer-facing email
- `CONTEXT.md` — the terms **Product accent**, **Customer-facing surface**,
  and **Damage type** are canonical there

---

## 1. Principles

1. **One accent per view.** Emerald marks the primary action and live/positive
   status. If more than one element on screen is solid emerald, something is
   wrong. Page titles, section headings, and body text are always neutral —
   never accent-colored.
2. **Color encodes meaning, never decoration.** Amber = needs attention /
   pending. Red = overdue, destructive, error. Emerald = live, active,
   success, primary action. Damage-type colors identify job categories. No
   other color usage.
3. **Depth comes from the surface scale, not shadows.** Three surface steps
   plus borders create all layout structure. No drop shadows except on
   floating layers (popovers, dialogs).
4. **Density with breathing room.** This is a power tool used all day —
   compact rows, tight tables — but page headers, section gaps, and card
   padding stay generous. Don't compress vertical rhythm to fit more widgets.
5. **Mobile is a first-class citizen.** Techs use this from phones in flooded
   houses. Every screen must work at 390px with 44px+ touch targets before it
   ships.
6. **Frontend-only discipline.** Styling work never changes data logic. See
   Guardrails (§9).

---

## 2. Color tokens

### 2.0 Token architecture

- The repo is **Tailwind v4, CSS-first**: every token is a CSS variable in
  `src/app/globals.css`, exposed as a utility through the `@theme inline`
  block. Values are authored in **oklch** (repo convention); the hex values
  in this document are the human-readable reference, the CSS is the
  conversion.
- **The app is dark-only** (ADR 0027). The palette below is the single
  `:root` value set. The former light palette, the `.dark` class split, the
  Settings → Company appearance picker, and system-theme switching are
  removed in migration step 1; components reading `useTheme` (e.g. the
  sonner toaster) are pinned dark; `next-themes` is dropped at cleanup.
- **Existing shadcn slot first; new token only when no slot fits.** New
  tokens must be registered in `@theme inline`. Never invent a third name
  for a color that already has a slot.
- **Step 1 deletes the legacy decorative families** — `--vibrant-*`,
  `--gradient-*`, `--shadow-card`, `--shadow-card-hover`,
  `--shadow-vibrant`, `--shadow-glow-primary`, and the light palette — so
  stale references break loudly during migration instead of lingering.
- The `--brand-*` triad is **kept** but becomes customer-surface-only
  (§2.8). In-app usages of `--brand-*` are migrated to semantic tokens
  module-by-module.

**Mapping table (doc name → CSS variable).** Agents use this table; never
guess a mapping.

| This document says | CSS variable | Status |
|---|---|---|
| Page canvas | `--background` | existing slot |
| Sidebar surface | `--sidebar` | existing slot |
| Card surface | `--card` | existing slot |
| Raised surface | `--muted` | existing slot |
| Overlay surface | `--popover` | existing slot |
| Default border | `--border` | existing slot |
| Strong border (inputs, secondary buttons) | `--input` | existing slot |
| Subtle border (row separators) | `--border-subtle` | **new** |
| Primary text | `--foreground` | existing slot |
| Secondary text | `--text-secondary` | **new** |
| Muted text | `--muted-foreground` | existing slot |
| Faint text | `--text-faint` | **new** |
| Solid accent | `--primary` / `--primary-foreground` | existing slots |
| Accent text/links | `--accent-text` | **new** |
| Accent tint bg | `--accent-tint` | **new** |
| Active nav item | `--sidebar-accent` / `--sidebar-accent-foreground` | existing slots (tint + accent text values) |
| Focus ring | `--ring` | existing slot |
| Danger | `--destructive` | existing slot |
| Warning text / tint | `--warning` / `--warning-tint` | **new** |
| Chart series | `--chart-1` … `--chart-5` | existing slots (new dark values) |

### 2.1 Surfaces (dark scale)

| Token | Hex (reference) | Use |
|---|---|---|
| `--background` | `#0B0F0E` | Page canvas |
| `--sidebar` | `#0E1312` | Sidebar / app chrome |
| `--card` | `#111715` | Cards, widgets, panels |
| `--muted` | `#141A18` | Metric cards, hover states, nested surfaces |
| `--popover` | `#1A211E` | Popovers, dropdowns, dialogs |

### 2.2 Borders

| Token | Value | Use |
|---|---|---|
| `--border` | `rgba(255,255,255,0.07)` | Default hairline on cards and dividers |
| `--border-subtle` | `rgba(255,255,255,0.05)` | Row separators inside cards |
| `--input` | `rgba(255,255,255,0.14)` | Inputs, secondary buttons, hover emphasis |

### 2.3 Text

| Token | Hex (reference) | Use |
|---|---|---|
| `--foreground` | `#E7ECEA` | Headings, names, values |
| `--text-secondary` | `#B9C2BE` | Nav items, labels, body copy |
| `--muted-foreground` | `#8B958F` | Metadata, timestamps, captions, placeholders |
| `--text-faint` | `#79857F` | Section eyebrows, disabled |

> **Contrast audit (step 1, 2026-07-01, #909):** verified against `--card`
> at the smallest specified sizes (12px / 11px), WCAG AA 4.5:1. As
> predicted, the draft `--text-faint` `#5E6A65` failed (3.22:1); draft
> `--muted-foreground` `#7A867F` passed with little headroom (4.79:1). Both
> values were shifted — `--muted-foreground` → `#8B958F` (5.87:1),
> `--text-faint` → `#79857F` (4.73:1) — keeping the hue and the visible
> hierarchy step between them. The audit lives on as an executable
> regression test in `src/app/design-tokens.test.ts`. Caveat: `--text-faint`
> on `--popover` measures 4.28:1 — keep faint text off overlay surfaces or
> step it up to `--muted-foreground` there.

### 2.4 Accent (emerald — the Product accent)

| Token | Value | Use |
|---|---|---|
| `--primary` | `#10B981` | Solid fill: the one primary button per view, live indicators |
| `--primary-foreground` | `#052E22` | Text on solid emerald |
| `--accent-text` | `#5EEAD4` | Accent-colored text/links/icons on dark surfaces (passes contrast where `#10B981` text does not) |
| `--accent-tint` | `rgba(16,185,129,0.14)` | Badge/pill backgrounds, count chips |
| `--ring` | `#10B981` | Focus ring |

Rules:

- Solid `--primary` fill appears **at most once per view**. Everything else
  accent-flavored uses tint + `--accent-text`.
- The active nav item uses `--sidebar-accent` (tint value) +
  `--sidebar-accent-foreground` (accent-text value).
- **shadcn's default Button variant renders solid `--primary`** — the moment
  step 1 lands, every default-variant button in the app turns emerald. Step 1
  therefore includes an audit pass: each view keeps exactly one primary
  button; the rest are demoted to secondary or ghost.
- The Product accent never appears on a Customer-facing surface (§2.8).

### 2.5 Semantic

| Token | Fill | Tint bg | Text on dark | Meaning |
|---|---|---|---|---|
| `--warning` / `--warning-tint` | `#F59E0B` | `rgba(251,191,36,0.14)` | `#FBBF24` | Pending, aging, needs attention |
| `--destructive` | `#DC2626` | `rgba(239,68,68,0.14)` | `#F09595` | Overdue, destructive, errors |
| Success | (use accent) | (use accent tint) | `#5EEAD4` | Success shares the emerald family |

### 2.6 Badge colors (damage type, urgency, status)

Three badge vocabularies exist and all use the same treatment: **tint
background + colored text, never solid fills.**

**Damage type** (canonical term — never "loss type"; see `CONTEXT.md`). A
stored field on the Job, chosen at Intake — never derived from the job
number. Eight canonical values with these **default** dark-tint colors,
used for seeded `damage_types` rows:

| Type | Text | Tint bg |
|---|---|---|
| Water | `#7DD3FC` | `rgba(56,189,248,0.14)` |
| Fire | `#FDBA74` | `rgba(251,146,60,0.14)` |
| Mold | `#BEF264` | `rgba(163,230,53,0.14)` |
| Storm | `#C4B5FD` | `rgba(167,139,250,0.14)` |
| Biohazard | `#FDA4AF` | `rgba(244,63,94,0.14)` |
| Contents | `#FDE047` | `rgba(250,204,21,0.14)` |
| Rebuild | `--text-secondary` | `rgba(255,255,255,0.07)` |
| Other | `--text-secondary` | `rgba(255,255,255,0.07)` |

Damage-type colors are **per-Organization data** (`damage_types.bg_color` /
`text_color`, set in the settings builder). The badge component softens
whatever is stored into the tint treatment — ~14%-alpha background plus a
legibility-adjusted text tone — so a custom color can never break the dark
theme. The static light-mode maps in `src/lib/badge-colors.ts`
(`bg-sky-100 text-sky-800` …) are migrated to these dark values in the Jobs
step; that is a display-only change.

**Urgency** maps to the semantic palette: emergency = danger, urgent =
warning, scheduled = neutral (`--muted-foreground` text on
`rgba(255,255,255,0.05)`).

**Job status** colors stay config-driven per ADR 0022
(`job-status-presentation.ts`) — the overhaul restyles them into the tint
treatment but does not move where they come from.

Damage-type badges appear on every job row, job card, and the job detail
header, alongside status and urgency.

### 2.7 Charts

Chart.js receives colors as JS values, so charts silently keep old colors
unless told otherwise. Rules:

- Series colors come from `--chart-1` … `--chart-5`, read from CSS at
  runtime via a small shared helper — never hex literals in chart configs.
- Dark values: chart-1 emerald `#10B981`, chart-2 sky `#38BDF8`, chart-3
  amber `#FBBF24`, chart-4 violet `#A78BFA`, chart-5 rose `#F87171`.
- Grid lines use `--border`, axis labels `--muted-foreground`, tooltips the
  `--popover` surface.

### 2.8 Customer-facing surfaces (the other palette)

A **Customer-facing surface** (canonical term — see `CONTEXT.md`) is any
artifact an outside party sees: billing / report / contract PDFs, the public
signing and viewing pages, and outgoing email frames.

- Always rendered on a **light palette**, regardless of the app's dark theme.
- Built on the document brand triad — `--brand-primary #0F6E56`,
  `--brand-secondary #1B2B4B`, `--brand-accent #C41E2A` — which survives the
  token cleanup but is reserved for these surfaces only.
- The Organization's identity leads (its logo, its chosen button color) per
  ADR 0017; the Product accent (emerald) never appears here.
- PDF renderers (`@react-pdf/renderer`) don't inherit CSS variables — their
  palettes are defined in the PDF components and stay light. Reskin work
  never touches them except under §9's money-path rules.
- The email **reading pane** renders received HTML mail, which is authored
  for white backgrounds: message bodies display inside a light content
  island, not inverted into the dark theme. The compose surface is likewise
  light so what you write matches what recipients see.

---

## 3. Typography

- **Family:** Inter via `next/font` (already wired in `src/app/layout.tsx`),
  with `font-feature-settings: "cv11", "ss01"` for the cleaner alternates.
  Tabular numerals (`font-variant-numeric: tabular-nums`) on all timers,
  currency, and table number columns.
- **Scale:**

| Role | Size / weight | Notes |
|---|---|---|
| Page title | 20px / 600 | Neutral color, never accent |
| Page subtitle | 13px / 400 | `--muted-foreground`; contextual (date, count) |
| Section / card title | 14px / 600 | |
| Body / rows | 13px / 400–500 | Names at 500, metadata at 400 muted |
| Metadata / timestamps | 12px / 400 | `--muted-foreground` |
| Eyebrow labels | 11px / 500, `letter-spacing: 0.04em` | `--text-faint`, sentence case |
| Metric value | 22px / 600 | Tabular nums |
| Metric label | 12px / 400 | `--muted-foreground` |

- Sentence case everywhere: buttons, headings, labels, nav. Never Title Case,
  never all-caps (eyebrows use letter-spacing, not uppercase — if uppercase
  is used, keep it to eyebrows only).
- No font sizes below 11px anywhere.
- Form inputs are the one exception to the scale: **16px minimum** (§7.4,
  iOS auto-zoom).

---

## 4. Spacing, radius, layout

- **Grid:** 4px base. Component-internal gaps: 8 / 12 / 16px. Section gaps:
  16–24px. Page padding: 24–32px desktop, 16px mobile.
- **Radius:** 8px inputs and buttons, 10px cards and widgets, 12px dialogs,
  full for pills/avatars. The shadcn scale derives from `--radius` —
  step 1 tunes `--radius` and the multiplier steps so `md` ≈ 8px, `lg` ≈
  10px, and dialogs land at 12px, rather than hardcoding radii per
  component.
- **Page shell:** persistent sidebar (240px desktop, collapsible; sheet/drawer
  on mobile) + main content. Main content max-width 1440px, fluid below that.
- **Dashboard layout:** page header row → 4-up KPI metric row → responsive
  2-column widget grid (`minmax(0,1fr)`; single column below 900px).
- **Page header pattern (every page):** title + subtitle left; secondary
  action(s) + the single primary action right. This is the only place a solid
  `--primary` button lives.

---

## 5. Component conventions

All components come from shadcn/ui, restyled through the tokens above. Do not
install alternative component libraries.

**Buttons.** Primary = solid emerald (one per view — see the §2.4 audit
rule). Secondary = transparent bg, `--input` border, `--text-secondary`.
Ghost = no border, hover `--muted`. Destructive = danger fill, confirmation
dialog required. Verb-first labels ("Create job", not "Submit").

**Badges / pills.** Tint background + matching colored text, 11–12px, radius
full, `padding: 1px 8px`. Used for: job status, damage type, urgency, counts,
unread indicators. Never solid-fill badges. Color sources per §2.6.

**Cards / widgets.** `--card` bg, `--border` hairline, radius 10px, padding
12–16px. Widget header row: title left, count chip or "View all →" link
(`--accent-text`) right. Rows inside separated by `--border-subtle`.

**Metric (KPI) cards.** `--muted` bg, border at 0.06 alpha, label above
value. Value color is neutral unless the metric itself is a warning (e.g.
Outstanding high → warning text).

**Tables / lists.** Row height 40–44px, hairline row borders (no zebra
striping), hover `--muted`. Every job row: name, job number, damage-type
badge, status badge, then metadata.

**Avatars.** Initials on `--popover` circle, `--accent-text` or
`--muted-foreground` letters. 22–28px in rows, 32–40px in headers.

**Nav (sidebar).** Grouped with eyebrow labels: Jarvis (pinned top) ·
**Work:** Dashboard, Jobs, Intake, Photos · **Comms:** Email, Phone, Contacts
· **Business:** Accounting, Marketing, Referral Partners · Settings +
workspace + user pinned bottom. Active item: `--sidebar-accent` bg +
`--sidebar-accent-foreground`. Count chips (e.g. unread) use the same tint
style. Compact "N" logo mark, not the full AAA logo.

**Jarvis chat** (finalized in step 14, #922). User messages sit on `--muted`
(raised) bubbles aligned right; Jarvis messages on `--card` with a `--border`
hairline aligned left. Both bubbles are radius 16px with the inner corner
squared (`rounded-tr-sm` user / `rounded-tl-sm` Jarvis), and the Jarvis side
carries an `--accent-tint` "J" avatar. Streaming is a single small pulsing
`--accent-text` dot in a Jarvis-style card bubble — no three-dot bounce, no
skeletons mid-stream. The composer is a `--card` pill following input
conventions: the textarea stays 16px (`text-base`, no `md:` downgrade) so iOS
doesn't zoom on focus (§7.4). Message timestamps are muted 10px. Attachment
thumbnails and PDF chips use tokens (`--foreground/10` surfaces), never
hardcoded white. Jarvis is the only voice in the product that speaks as "I"
(§6).

**Empty states.** Icon (Lucide, muted) + one-line headline + one-line body +
CTA verb. Never a bare dashed box. "No one's on the clock" → show the
clock-in CTA inline.

**Loading.** Skeletons matching final layout shape (`--muted` shimmer-free
blocks). Every data widget must have a skeleton, an empty state, and an error
state.

**Icons.** Lucide only, 14–16px inline, 18–20px in nav, stroke width
1.75–2. Icon color follows its text color.

**Motion.** 150ms ease-out on hover/focus/expand. No entrance animations on
dashboards. Respect `prefers-reduced-motion`.

**Focus.** Visible focus ring on all interactive elements:
`0 0 0 2px var(--background), 0 0 0 4px var(--ring)`.

---

## 6. Content and voice

- Sentence case, contractions, plain verbs. No "please", no "successfully",
  no exclamation points in system copy.
- Errors: what happened + what to do, one sentence. No raw exception strings
  in the UI.
- Confirmations are past tense: "Invoice sent", "Job created".
- The product speaks as the product, never as "I" (that's Jarvis's register
  only).

---

## 7. Responsive rules (iPhone, iPad, desktop)

### 7.1 Breakpoints

Use these Tailwind breakpoints consistently. Design mobile-first: base styles
are phone, then layer up.

| Name | Width | Target device | Layout behavior |
|---|---|---|---|
| base | < 640px | iPhone (390–430px typical) | Single column; sidebar = drawer/sheet; KPI row 2×2; tables collapse to card rows |
| `sm` | ≥ 640px | Large phones landscape | Same as base unless content clearly benefits |
| `md` | ≥ 768px | iPad portrait | Sidebar = icon rail (56px, tooltips on hover/long-press); widget grid 2-col; tables stay tables; KPI row 4-up |
| `lg` | ≥ 1024px | iPad landscape / small laptop | Full sidebar (240px); desktop layout |
| `xl` | ≥ 1280px | Desktop | Full layout, max-width 1440px |

### 7.2 iPad-specific rules

- iPad is a field device for this app: intake forms, photo review/annotation,
  and signatures happen here. Treat `md`–`lg` as a primary target, not an
  afterthought.
- All hover-only affordances must have a touch equivalent — no information or
  action may be reachable only via hover. Row actions that appear on hover on
  desktop are always visible (or behind an explicit ⋯ menu) at `md` and below.
- Forms at `md`: two-column field layout where fields are related
  (city/state/zip), single column otherwise. Signature and annotation
  canvases get maximum available width.
- Support Split View gracefully: an iPad in 50% Split View is ~507px wide and
  should render the base (phone) layout — this falls out naturally if base
  styles are phone-first, so never key layout off user-agent, only viewport
  width.

### 7.3 iPhone rules

- Every migrated page verified at 390px width before merge.
- Touch targets ≥ 44px; primary actions in thumb reach (bottom of viewport or
  top-right, never mid-scroll only).
- Sidebar becomes a drawer; KPI row wraps to 2×2; widget grid stacks
  single-column.
- Tables collapse to card rows (name + badges + one key metadata line).

### 7.4 iOS Safari requirements (apply globally, not per-page)

- **All form inputs use `font-size: 16px` minimum** — anything smaller
  triggers iOS auto-zoom on focus. This overrides the general type scale for
  inputs only.
- **Never use `100vh`.** Use `100dvh` (dynamic viewport height) for
  full-height layouts so content doesn't hide behind Safari's collapsing
  toolbar.
- **Safe areas:** apply `env(safe-area-inset-*)` padding to the app shell —
  bottom padding on any bottom-anchored bar or drawer (home indicator), top
  on fixed headers. Set `viewport-fit=cover` in the viewport meta tag.
- Set `-webkit-tap-highlight-color: transparent` globally and provide our own
  `:active` states (150ms `--muted` press feedback) so taps feel intentional,
  not flashy.
- Overscroll: `overscroll-behavior: none` on the app shell to prevent
  rubber-band scroll from revealing the page background behind fixed chrome.
- Sticky positioning inside scroll containers is unreliable in iOS Safari —
  test any `position: sticky` header/toolbar on a real device before relying
  on it.
- Momentum scrolling on any internal scroll region:
  `-webkit-overflow-scrolling: touch`.
- Set `color-scheme: dark` on `:root` so native controls (scrollbars —
  including Windows desktop — date pickers, selects) render dark, and
  override WebKit autofill's yellow input background.

### 7.5 Verification per module

Definition of done for responsiveness: verified at **390px (iPhone), 768px
(iPad portrait), 1024px (iPad landscape), and desktop** — via browser
devtools presets at minimum, real devices for intake, photos, and billing.

### 7.6 Native shell (Capacitor iOS)

The iPhone app is the web app inside a Capacitor shell plus a native photo
capture flow (`src/app/(mobile)`, `src/components/mobile`).

- **Shell chrome is part of migration step 2:** iOS status bar set to light
  text over the dark canvas, splash screen background `#0B0F0E`, safe-area
  padding per §7.4. Skipping these makes the dark theme look broken on every
  app launch.
- **The capture flow (camera view, review screen, upload queue) is deferred
  to the Photos step** and treated like the photo annotator: reskin only the
  buttons and sheets around the camera — never the camera, queue, or upload
  logic (§9).
- Outdoor/sunlight readability of the dark theme is verified on a real
  device early in the rollout (Dashboard or Jobs, phone, outside) — see
  ADR 0027.

---

## 8. Migration order and definition of done

Step 1 restyles the shared primitives, so **every page shifts appearance
immediately** — unlisted pages get most of the new look for free, unverified.
This list is the order in which each surface gets its dedicated
verify-and-polish pass:

1. Tokens + globals + shadcn primitive restyle (includes the §2.4 primary-
   button audit, the §2.3 contrast audit, and deleting the legacy families)
2. App shell — sidebar, topbar, page header, **native shell chrome (§7.6)**
3. Dashboard
4. Jobs list
5. Job detail (redesign; includes Financials tab and Sketch *chrome* only)
6. Intake (mobile-first redesign)
7. Photos chrome (reskin only; includes the native capture-flow chrome)
8. Billing surfaces shared chrome (payments, send/export modals)
9. Email client chrome (reskin only; light content island per §2.8)
10. Settings/org
11. Estimates + estimate builder + invoices (reskin only — money path,
    extra review; the builder is the largest single screen in the app)
12. Contracts + signing (signature capture stays dark-ink-on-light)
13. Phone + Contacts
14. Jarvis (chat patterns per §5, refined here)
15. Accounting + Reports (charts get the §2.7 palette here)
16. Marketing + Referral Partners
17. Sketch chrome (toolbars, panels, dialogs — canvas and 3D view untouched)
18. Login + odds and ends (trash, logout, set-password, public in-app pages)

One module per branch. Vercel preview reviewed before merge. **Done means:**
tokens only (no hardcoded colors), loading/empty/error states present,
verified at all §7.5 breakpoints, keyboard focus visible, no console errors,
existing functionality untouched.

> Repo reality: this working copy lives under OneDrive, which is known to
> corrupt stash/branch operations mid-sync — pause OneDrive or use WIP
> commits when switching module branches.

---

## 9. Guardrails for Claude Code (non-negotiable)

1. **Frontend-only diffs.** Do not modify: Supabase schema, migrations, RLS
   policies, server actions' logic, API routes' behavior, auth flows, or the
   multi-org tenant isolation layer. If a styling change seems to require a
   data-layer change, stop and ask.
2. **Do not touch Fabric.js canvas logic** in the photo annotation system.
   Reskin only the chrome around it.
3. **Do not touch the Sketch canvas or 3D view logic** (the 2D plan canvas
   and the three.js dollhouse). Reskin only the toolbars, panels, and
   dialogs around them.
4. **Do not touch signature capture internals** (`signature_pad` usage in
   contracts and timesheet certification). Signature canvases stay
   dark-ink-on-light — a signature drawn on a dark surface would render
   wrong on the printed document.
5. **Do not touch email client state management** (IMAP sync, account
   handling). Chrome and styling only.
6. **No new dependencies** without explicit approval in the session. No
   component library swaps, no CSS framework changes, no icon set changes.
7. **Preserve component APIs.** Restyled components keep their existing props
   and exports so untouched pages keep working.
8. **No billing/payment flow logic changes.** Money paths are reskin-only,
   and even visual changes there get extra review.
9. Work on a feature branch; never push styling work directly to main.
10. When uncertain whether something is "styling" or "logic", it's logic —
    ask first.
