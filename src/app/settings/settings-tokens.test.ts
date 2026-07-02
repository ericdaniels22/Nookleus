import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// design-system v2 step 10 (issue #919, docs/design-system.md §5/§8/§9).
//
// The Settings/org verify-and-polish pass is presentation-only: it moves the
// live settings tree onto the dark tokens and §5 form/table conventions with
// zero behavior/config-schema/API change. This suite is the executable half
// of §8's "definition of done: tokens only (no hardcoded colors)" — it parses
// each migrated settings-chrome file and asserts it carries no hardcoded
// color, no `dark:` variant (dark-only, ADR 0027), no in-app `--brand-*`
// (§2.8 reserves the brand triad for customer-facing surfaces), and no
// off-scale type. It grows one slice at a time: each page/tab lands in
// MIGRATED as it is restyled (mirrors src/app/design-tokens.test.ts, the
// step-1 global sweep).
//
// Out of scope for step 10 (NOT listed in MIGRATED):
//   - redirect stubs (accounting/, stripe/, statuses/, vendors/, …) render nothing
//   - estimate-templates/[id]/edit — estimate builder, migration step 11
//   - contract-templates/[id]/edit — contract PDF builder, step 12 (§2.8 money path)
//   - pdf-presets/[id]/edit — PDF preset editor (§2.8 PDF renderer, light)
//   - company/appearance-section.tsx — brand-color editor (§2.8 carve-out):
//       it edits and live-previews the --brand-* triad, so its brand hex
//       defaults, --brand-* writes, and preview swatches stay brand by design.
//       (Removing it would be an out-of-scope behavior change, so step 10
//       leaves it functionally + visually untouched.)
//   - jobs/statuses-tab.tsx, jobs/damage-types-tab.tsx — status / damage-type
//       builders. Their chrome IS retokenised, but each seeds a new row with a
//       user-editable color (a hardcoded default hex) and previews saved rows
//       via inline style={{…user hex…}}. That hex is per-tenant CONFIG data,
//       not chrome, so the file can't clear the raw-hex sweep — EXEMPT (config
//       schema + save behavior unchanged; only surrounding chrome moved).
//   - form-builder/inspector.tsx — intake-form field inspector; chrome moved to
//       tokens, but PILL_COLOR_PRESETS is a fixed set of user-selectable pill
//       colors whose hex IS the feature's data. Same carve-out — EXEMPT.
//   - money/expense-categories-tab.tsx — expense-category builder. Chrome IS
//       retokenised, but it seeds a new category's badge color from default hex
//       (newBg/newText) with matching edit state, and previews saved rows via
//       inline style={{…user hex…}}. Per-tenant CONFIG data, not chrome — same
//       carve-out as the status / damage-type builders. EXEMPT.
//   - email/signatures-tab.tsx — email-signature editor. Chrome IS retokenised,
//       but the live preview renders the signature HTML on a white card with
//       gray prose ("always rendered on white bg to match how emails look") —
//       a §2.8 customer-facing email-body preview, kept light by design. EXEMPT.
// Customer-facing surfaces embedded in a migrated file (§2.8: org brand swatches,
// email-body / template-body previews rendered light) keep their brand/light
// colors; where that means a file legitimately carries brand hex it is called
// out inline in EXEMPT with a reason rather than listed in MIGRATED.

/** Settings-chrome files restyled onto the dark tokens (§8 done = tokens only). */
const MIGRATED: readonly string[] = [
  // shell
  "src/app/settings/layout.tsx",
  "src/components/settings/settings-tabs.tsx",
  // company (§919 step 10 slice 1)
  "src/app/settings/company/page.tsx",
  "src/app/settings/company/profile-tab.tsx",
  "src/app/settings/company/timezone-section.tsx",
  "src/app/settings/company/branding-tab.tsx",
  "src/app/settings/company/pdf-presets-section.tsx",
  // jobs → intake-form builder (§919 step 10 slice 2). Chrome only: config
  // schemas, save behavior, and the intake-form/versions/restore API routes are
  // unchanged (builders restyle presentation only). The statuses / damage-types
  // tabs and the inspector are EXEMPT — see the header note — because they carry
  // user-chosen color CONFIG (seed/preset hex) that is data, not chrome styling.
  "src/app/settings/jobs/page.tsx",
  "src/app/settings/jobs/intake-form-tab.tsx",
  "src/components/form-builder/canvas.tsx",
  "src/components/form-builder/canvas-section.tsx",
  "src/components/form-builder/canvas-field.tsx",
  "src/components/form-builder/palette.tsx",
  "src/components/form-builder/version-pill.tsx",
  "src/components/form-builder/test-mode.tsx",
  // templates (§919 step 10 slice 3). Chrome only: the estimate/contract/
  // item-library/photo-report template LISTS and their builders' presentation
  // move to tokens; config schemas, save behavior, and the template/item-library
  // API routes are unchanged. The route-level /edit builders are NOT here — the
  // estimate builder (estimate-templates/[id]/edit) is step 11 and the contract
  // PDF builder (contract-templates/[id]/edit) is step 12 (§2.8 money path); the
  // lists just link out to them. The photo-report template builder is a
  // settings-embedded content editor (section headings + boilerplate text, not a
  // customer-facing PDF preview), so its chrome retokenises here.
  "src/app/settings/templates/page.tsx",
  "src/app/settings/templates/estimates-tab.tsx",
  "src/components/templates/template-list-client.tsx",
  "src/components/templates/delete-template-confirm-dialog.tsx",
  "src/app/settings/templates/contracts-tab.tsx",
  "src/app/settings/templates/item-library-tab.tsx",
  "src/components/item-library/item-table.tsx",
  "src/components/item-library/item-form.tsx",
  "src/app/settings/templates/photo-report-templates-tab.tsx",
  "src/app/settings/templates/photo-report-defaults-tab.tsx",
  "src/components/report-template-builder.tsx",
  // money (§919 step 10 slice 4). Reskin-only, extra review (§9 money-path
  // guardrail): className swaps only — no billing / QuickBooks / Stripe / vendor
  // logic, save behavior, or API routes touched. expense-categories-tab.tsx is
  // EXEMPT (see header): it seeds a new category's badge color from a default hex
  // and previews rows via inline style={{…}} — per-tenant CONFIG data, not chrome.
  "src/app/settings/money/page.tsx",
  "src/app/settings/money/stripe-tab.tsx",
  "src/app/settings/money/quickbooks-tab.tsx",
  "src/app/settings/money/vendors-tab.tsx",
  // people + photos (§919 step 10 slice 5). Chrome only: users/permissions/
  // notification-prefs and quick-pick-label management move to tokens; the
  // users, permissions, and label API routes + save behavior are unchanged.
  // The four team-member role badges are a fixed enum (not per-org config), so
  // their dark-tint palette now lives as JIT-safe literals in badge-colors.ts
  // (`roleColors`, reusing the §2.6 damage-type hues) and the tab consumes it
  // via className — the chrome file itself carries no palette color.
  "src/app/settings/people/page.tsx",
  "src/app/settings/people/users-crew-tab.tsx",
  "src/app/settings/people/notifications-tab.tsx",
  "src/app/settings/photos/page.tsx",
  "src/app/settings/photos/quick-pick-labels-tab.tsx",
  // email + outgoing (§919 step 10 slice 6). Chrome only: the email-accounts,
  // email-templates list/editor, and outgoing-queue pages move to tokens; the
  // IMAP/SMTP account, template, and send-queue API routes + save behavior are
  // unchanged. signatures-tab.tsx is EXEMPT (see header): its live signature
  // preview renders on a white card with gray prose to match how the signature
  // looks inside a real (light) email body — a §2.8 customer-facing preview, so
  // its chrome retokenises but the preview stays light.
  "src/app/settings/email/page.tsx",
  "src/app/settings/email/accounts-tab.tsx",
  "src/app/settings/email/templates-tab.tsx",
  "src/app/settings/outgoing/page.tsx",
  // phone + connections + data (§919 step 10 slice 7). Chrome only: the phone
  // numbers / opt-outs / recording tabs, the Google + Website connection cards,
  // and the knowledge-base / data-export pages move to tokens; the phone,
  // google/website-connection, knowledge, and export API routes + save behavior
  // are unchanged. Two categorical-color decisions, both tokenised (no EXEMPT):
  //   - The connection cards carried third-party SERVICE brand hex (Google
  //     #4285F4, WordPress #21759b). §2.8 reserves the brand triad for the
  //     ORG's own identity on customer-facing artifacts — a vendor's brand
  //     color hardcoded in app chrome is neither the org brand nor a
  //     customer-facing surface, so it tokenises: the service logo tile → the
  //     accent chip (bg-accent-tint/text-accent-text) and the connect CTA →
  //     the primary button. The "G" glyph / Globe icon + service heading still
  //     name the vendor; only the raw hex is gone.
  //   - The knowledge-base ingestion status (processing / ready / error) is a
  //     fixed 3-state enum, not the per-org §2.6 job-status vocabulary, so it
  //     maps to semantic state tokens (warning / primary / destructive) rather
  //     than through resolveStatusBadge.
  "src/app/settings/phone/page.tsx",
  "src/app/settings/phone/phone-numbers-tab.tsx",
  "src/app/settings/phone/opt-outs-tab.tsx",
  "src/app/settings/phone/recording-settings-tab.tsx",
  "src/app/settings/connections/page.tsx",
  "src/app/settings/connections/google-connection-card.tsx",
  "src/app/settings/connections/website-connection-card.tsx",
  "src/app/settings/data/page.tsx",
  "src/app/settings/data/export-tab.tsx",
  "src/app/settings/data/knowledge-base-tab.tsx",
  // navigation → nav-order builder (§919 step 10 slice 8). The admin-only
  // sidebar reorder page; the nav-order API route + save behavior are
  // unchanged. Already token-native (text-foreground / bg-card / border-border,
  // no palette color / dark: / brand / off-scale type) — added to lock it in.
  "src/app/settings/navigation/page.tsx",
  // money/accounting client bodies (§919 step 10 slice 9). The Money slice
  // migrated only the thin tab wrappers; these are the large client bodies
  // they render — the QuickBooks settings panel (inside money → QuickBooks),
  // the Stripe settings panel (inside money → Stripe), and the QB first-run
  // setup wizard at /settings/accounting/setup (reached from the QB OAuth
  // callback + the qb-fix-modal). Money/billing path: chrome only — the QB /
  // Stripe connection, sync, mapping, and dry-run API routes + save behavior
  // are untouched.
  "src/app/settings/accounting/accounting-settings-client.tsx",
  "src/app/settings/stripe/stripe-settings-client.tsx",
  "src/app/settings/accounting/setup/setup-wizard-client.tsx",
];

interface Rule {
  id: string;
  re: RegExp;
  hint: string;
}

const FORBIDDEN: readonly Rule[] = [
  {
    id: "tailwind-palette-color",
    re: /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|caret|accent|placeholder|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?(?:\/\d{1,3})?\b/,
    hint: "use a design-system token (bg-card, text-foreground, text-destructive, text-accent-text…), not a Tailwind palette color",
  },
  {
    id: "arbitrary-color-value",
    re: /(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|shadow|outline|caret|accent|placeholder)-\[(?:#|rgb|hsl|oklch)/i,
    hint: "no arbitrary color values in utilities — map the color to a token",
  },
  {
    id: "raw-hex-literal",
    re: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/,
    hint: "no hardcoded hex — use a token / CSS variable",
  },
  {
    id: "dark-variant",
    re: /(?:^|[\s"'`{(])dark:/,
    hint: "dark-only app (ADR 0027) — fold dark: styles into the base styles",
  },
  {
    id: "in-app-brand-token",
    re: /--brand-(?:primary|secondary|accent)/,
    hint: "§2.8 — the brand triad is customer-surface-only; use a semantic token in app chrome",
  },
  {
    id: "off-scale-type",
    re: /\b(?:text-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)|font-(?:extrabold|black))\b/,
    hint: "§3 type scale — settings page title is 20px/600 (text-xl font-semibold) at most",
  },
  {
    // matches text-[0px]..text-[10px]; 11px+ is two digits starting 11+, so 16px inputs / 13px etc. pass
    id: "undersized-type",
    re: /text-\[(?:[0-9]|10)px\]/,
    hint: "§3 type scale — no font below 11px; use text-[11px] / text-xs or larger",
  },
];

/**
 * Strip //-line and (single- or multi-line) block comments while preserving
 * line indices, so a color token quoted inside a code comment never trips the
 * sweep. `//` inside a string (e.g. an https:// URL) may over-strip that line
 * — acceptable, it can only hide a violation, never invent one.
 */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let s = raw;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      s = s.slice(end + 2);
      inBlock = false;
    }
    s = s.replace(/\/\*.*?\*\//g, "");
    const open = s.indexOf("/*");
    if (open !== -1) {
      inBlock = true;
      s = s.slice(0, open);
    }
    const dbl = s.indexOf("//");
    if (dbl !== -1) s = s.slice(0, dbl);
    out.push(s);
  }
  return out;
}

function violations(relPath: string): string[] {
  const source = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const lines = stripComments(source);
  const hits: string[] = [];
  lines.forEach((line, i) => {
    for (const rule of FORBIDDEN) {
      const m = line.match(rule.re);
      if (!m) continue;
      // Sanctioned scrim: an alpha-black overlay wash (bg-black/40) is the
      // overlay backdrop rendered verbatim by ui/dialog.tsx + ui/sheet.tsx
      // after the step-1 restyle. There is no scrim/backdrop token, so an
      // alpha-black wash IS the design-system overlay backdrop — not a stray
      // palette color. (Solid bg-black without an alpha still trips the rule.)
      if (rule.id === "tailwind-palette-color" && /^bg-black\/\d/.test(m[0])) continue;
      hits.push(`L${i + 1} [${rule.id}] "${m[0]}" — ${rule.hint}`);
    }
  });
  return hits;
}

describe("settings design-system v2 sweep — §8 done = tokens only (#919)", () => {
  it.each(MIGRATED)("%s carries no hardcoded color / dark: / brand / off-scale type", (file) => {
    expect(violations(file), `${file} still has non-token styling`).toEqual([]);
  });
});
