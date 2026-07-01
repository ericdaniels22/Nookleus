# Design system v2 is dark-only and maps onto the shadcn token slots

**Status:** Accepted
**Date:** 2026-07-01

## Context

The frontend design overhaul (design system v2 — "calm, dark, professional
command center") replaces the current look: a light-by-default "vibrant"
palette with a `.dark` variant, `defaultTheme="system"` via next-themes, and
a user-facing appearance picker in Settings → Company.

The repo's styling architecture is Tailwind v4 CSS-first: `@theme inline` in
`src/app/globals.css` registers utilities from CSS variables, values are
oklch, and the shadcn semantic slot set is already wired (`--background`,
`--card`, `--popover`, `--muted`, `--sidebar-*`, `--chart-1..5`, …). The
design-system document introduced its own parallel token vocabulary
(`--surface-raised`, `--surface-overlay`, `--text-secondary`, `--accent-tint`)
in hex/rgba. Two vocabularies for the same colors would make every future
session pick one at random and drift.

Tension considered: field techs use the app outdoors, where dark UIs are
harder to read in direct sunlight than light ones; but a dual theme doubles
the token table and the per-module verification matrix forever.

## Decision

1. **The app is dark-only.** The design system's dark palette becomes the
   single `:root` value set. The light palette, the `.dark` class split, and
   the Settings → Company appearance picker are removed. System-theme
   switching goes with them (components reading `useTheme`, e.g. the sonner
   toaster, are pinned to dark).
2. **Existing shadcn slots first; new tokens only where no slot fits.** The
   design doc's vocabulary maps onto the slots already registered in
   `@theme inline`:
   `--surface-overlay` → `--popover`, `--surface-raised` → `--muted`,
   `--surface-sidebar` → `--sidebar`, active-nav tint → `--sidebar-accent`,
   `--text-primary` → `--foreground`, `--text-muted` → `--muted-foreground`,
   default/strong borders → `--border`/`--input`, focus → `--ring`,
   danger → `--destructive`.
   Genuinely new tokens are added and registered in `@theme inline`:
   `--text-secondary`, `--text-faint`, `--accent-text`, `--accent-tint`,
   `--warning`, `--warning-tint`. The design doc carries this mapping table;
   agents never invent a mapping.
3. **Values are authored in oklch**, the repo and shadcn v4 convention. The
   design doc's hex values are the reference; the CSS is the conversion.
4. **The legacy decorative token families are deleted, not left behind:**
   `--vibrant-*`, `--gradient-*`, `--shadow-card`/`--shadow-card-hover`/
   `--shadow-vibrant`/`--shadow-glow-primary`, and the light palette are
   removed in migration step 1 so stale references break loudly during the
   migration instead of lingering.

## Consequences

- Every module verifies at one theme, not two — half the QA matrix at each
  of the four required breakpoints.
- Outdoor readability is an accepted risk: verify Dashboard/Jobs on a real
  phone in sunlight early in the rollout; if it fails, the tokenized slots
  make authoring a light value set a palette task, not a rework.
- Removing the appearance picker is a deliberate feature removal, not an
  oversight.
- Customer-facing output (billing/report PDFs, contract emails) never
  followed the app theme and is unaffected; its palette is a separate
  decision.
- next-themes becomes unused once the picker and `.dark` split are gone and
  can be dropped from dependencies at cleanup.
