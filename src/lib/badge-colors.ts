import type { DamageType, JobStatus } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";

// Static badge palettes for job urgency and damage type. (Job-status colors and
// labels now come from useConfig() + src/lib/job-status-presentation.ts — the
// single source of truth per ADR 0022; #722 migrated the job-detail view off the
// old static status maps, so they no longer live here.)
// §2.6 urgency → semantic palette, same tint-not-fill treatment as damage
// type: emergency = danger (§2.5 destructive, text #F09595), urgent = warning
// (§2.5, amber-400 = #FBBF24 = --warning-tint), scheduled = neutral
// (--muted-foreground on white/5).
export const urgencyColors: Record<string, string> = {
  emergency: "bg-red-500/14 text-[#F09595] font-semibold",
  urgent: "bg-amber-400/14 text-amber-400",
  scheduled: "bg-white/5 text-muted-foreground",
};

export const urgencyLabels: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  scheduled: "Scheduled",
};

// §2.6 default dark-tint map: a ~14%-alpha wash of the type's hue behind
// colored text — never a solid fill. The shades below are exact Tailwind
// equivalents of the doc's reference values (e.g. sky-300 = #7DD3FC,
// sky-400/14 = rgba(56,189,248,0.14)); keeping them as palette classes (not
// arbitrary hexes) lets by-damage-type-tab keep deriving a chart hue from the
// family. Rebuild/Other are the neutral pair (--text-secondary on white/7).
export const damageTypeColors: Record<string, string> = {
  water: "bg-sky-400/14 text-sky-300",
  fire: "bg-orange-400/14 text-orange-300",
  mold: "bg-lime-400/14 text-lime-300",
  storm: "bg-violet-400/14 text-violet-300",
  biohazard: "bg-rose-500/14 text-rose-300",
  contents: "bg-yellow-400/14 text-yellow-300",
  rebuild: "bg-white/7 text-text-secondary",
  other: "bg-white/7 text-text-secondary",
};

// The light-mode seed (bg, text) every Organization starts with for the eight
// canonical damage types — the exact hexes the `damage_types` rows are seeded
// with (organization_id null). Single source of truth: config-context imports
// this for its pre-load fallback, and resolveDamageTypeBadge compares a stored
// color against it to tell an *uncustomized* default (→ vivid class map) from a
// per-org override (→ soften). Keep in lockstep with the DB seed migration.
export const DEFAULT_DAMAGE_COLORS: Record<string, { bg: string; text: string }> = {
  water: { bg: "#E6F1FB", text: "#0C447C" },
  fire: { bg: "#FAECE7", text: "#712B13" },
  mold: { bg: "#EAF3DE", text: "#27500A" },
  storm: { bg: "#EEEDFE", text: "#3C3489" },
  biohazard: { bg: "#FCEBEB", text: "#791F1F" },
  contents: { bg: "#FFF8E6", text: "#7A5E00" },
  rebuild: { bg: "#F1EFE8", text: "#5F5E5A" },
  other: { bg: "#F1EFE8", text: "#5F5E5A" },
};

// ---------------------------------------------------------------------------
// soften — per-Organization damage-type colors → theme-safe tint treatment.
//
// An Organization stores an arbitrary (bg_color, text_color) pair for each
// damage type in the settings builder. On the dark theme those raw colors
// can't be trusted to be legible, so the badge softens them: the stored bg
// becomes a ~14%-alpha wash (a low-alpha tint of *any* color is theme-safe),
// and the stored text is lightened just enough to clear WCAG AA against the
// card surface. Pure and deterministic — output is inline-style-ready.
// ---------------------------------------------------------------------------

/** The tint alpha applied to every softened background (§2.6 "~14%"). */
const TINT_ALPHA = 0.14;
/** The --card surface (§2.1) the softened text must stay legible on. */
const CARD_SURFACE = "#111715";
/** WCAG AA for normal text — badges render at 11–12px. */
const AA_CONTRAST = 4.5;

export interface SoftenedBadge {
  /** `rgba(...)` tint, ready for an inline `style.background`. */
  background: string;
  /** `#RRGGBB` text tone guaranteed legible on the card surface. */
  color: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  let n = hex.trim().replace(/^#/, "");
  if (n.length === 3) n = n.split("").map((c) => c + c).join("");
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function channelToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Lighten a stored text color just enough to clear WCAG AA on the card
 * surface, preserving its hue. Already-legible colors pass through unchanged;
 * fully unreachable hues terminate at white (which always passes). Contrast is
 * re-checked on the *rounded* candidate, so the emitted hex is guaranteed AA.
 */
function legibleTextTone(textHex: string): string {
  const card = parseHex(CARD_SURFACE);
  const rgb = parseHex(textHex);
  if (contrastRatio(rgb, card) >= AA_CONTRAST) return toHex(rgb);
  const { h, s, l } = rgbToHsl(rgb);
  for (let target = l; target <= 1.0001; target += 0.01) {
    const candidate = hslToRgb({ h, s, l: Math.min(1, target) });
    if (contrastRatio(candidate, card) >= AA_CONTRAST) return toHex(candidate);
  }
  return "#FFFFFF";
}

export function soften(bgHex: string, textHex: string): SoftenedBadge {
  const { r, g, b } = parseHex(bgHex);
  return {
    background: `rgba(${r}, ${g}, ${b}, ${TINT_ALPHA})`,
    color: legibleTextTone(textHex),
  };
}

// ---------------------------------------------------------------------------
// Badge resolvers — the §2.6 treatment the Jobs surfaces (#914) apply to a
// damage-type / status value. Each returns a BadgeStyle: EITHER a Tailwind
// `className` (the vivid dark-tint default, JIT-safe because it is a literal
// from the maps above) OR an inline `style` (a softened per-org color). The
// two branches are mutually exclusive, so a consumer can always spread both:
//   <Badge className={cn(base, badge.className)} style={badge.style} />
// ---------------------------------------------------------------------------

export interface BadgeStyle {
  /** Tailwind classes for the vivid class-map path (undefined on the soften path). */
  className?: string;
  /** Inline tint style for the soften path (undefined on the class-map path). */
  style?: { background: string; color: string };
}

/** Case/`#`-insensitive hex equality, so a seed match survives casing drift. */
function sameColor(a: string, b: string): boolean {
  return a.trim().replace(/^#/, "").toLowerCase() ===
    b.trim().replace(/^#/, "").toLowerCase();
}

/**
 * The badge treatment for a Job's damage type (§2.6). An uncustomized canonical
 * type — the stored color still equals its seed, or no row exists yet — renders
 * the vivid dark-tint class from `damageTypeColors`. A per-Organization override
 * (any color differing from the seed) is softened to a legible tint so a hostile
 * choice (white, neon) can't break the dark theme. A non-canonical custom type
 * with no color falls back to the neutral pair.
 */
export function resolveDamageTypeBadge(
  name: string,
  damageTypes: DamageType[],
): BadgeStyle {
  const stored = damageTypes.find((d) => d.name === name);
  const canonicalClass = damageTypeColors[name];
  const seed = DEFAULT_DAMAGE_COLORS[name];

  if (stored) {
    const isUncustomizedDefault =
      seed &&
      sameColor(stored.bg_color, seed.bg) &&
      sameColor(stored.text_color, seed.text);
    if (canonicalClass && isUncustomizedDefault) return { className: canonicalClass };
    return { style: soften(stored.bg_color, stored.text_color) };
  }

  // No stored row (pre-load, or a type the org never seeded): show the vivid
  // canonical class when we know it, else the neutral fallback.
  return { className: canonicalClass ?? damageTypeColors.other };
}

/**
 * The badge treatment for a Job's status (§2.6). Status colors stay
 * config-driven per ADR 0022 — this only restyles them into the tint treatment,
 * it never substitutes a different palette. The stored `job_statuses` color is
 * softened to a legible tint; before the config loads (or for an unknown key)
 * the presentation-module seed is softened instead, so the source of the color
 * never moves.
 */
export function resolveStatusBadge(
  name: string,
  statuses: JobStatus[],
): BadgeStyle {
  const stored = statuses.find((s) => s.name === name);
  if (stored) return { style: soften(stored.bg_color, stored.text_color) };
  const seed = getJobStatusPresentation(name).badge;
  return { style: soften(seed.bg, seed.text) };
}

// ---------------------------------------------------------------------------
// Payment badges (§2.5/§2.6, #917) — the Billing surface and Record-payment
// modal tag each payment with its source (which party paid) and status. Unlike
// damage type / job status these are a fixed enum (see `Payment` in types.ts),
// never per-Organization data, so a plain dark-tint class map (like
// `damageTypeColors`) is the source of truth — no soften()/inline-style path.
// Source is categorical (a hue per party); status is semantic (received =
// success/emerald, pending = warning/amber, due = destructive/red).
// ---------------------------------------------------------------------------

export const paymentSourceColors: Record<string, string> = {
  insurance: "bg-emerald-500/14 text-emerald-300",
  homeowner: "bg-sky-400/14 text-sky-300",
  other: "bg-white/7 text-text-secondary",
};

export const paymentStatusColors: Record<string, string> = {
  received: "bg-emerald-500/14 text-emerald-300",
  pending: "bg-amber-400/14 text-amber-400",
  due: "bg-red-500/14 text-[#F09595]",
};

/** Badge classes for a payment's source; an unknown value → the neutral pair. */
export function resolvePaymentSourceBadge(source: string): string {
  return paymentSourceColors[source] ?? paymentSourceColors.other;
}

/** Badge classes for a payment's status; an unknown value → the neutral pair. */
export function resolvePaymentStatusBadge(status: string): string {
  return paymentStatusColors[status] ?? paymentSourceColors.other;
}

export const damageTypeLabels: Record<string, string> = {
  water: "Water",
  fire: "Fire",
  mold: "Mold",
  storm: "Storm",
  biohazard: "Biohazard",
  contents: "Contents",
  rebuild: "Rebuild",
  other: "Other",
};
