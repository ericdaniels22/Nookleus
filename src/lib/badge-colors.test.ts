import { describe, expect, it } from "vitest";
import type { DamageType, JobStatus } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";
import {
  damageTypeColors,
  damageTypeLabels,
  DEFAULT_DAMAGE_COLORS,
  resolveDamageTypeBadge,
  resolveStatusBadge,
  soften,
  urgencyColors,
  urgencyLabels,
} from "./badge-colors";

// Fidelity harness (design-system.md §2.5/§2.6). The badge maps are Tailwind
// class strings; this suite resolves those classes back to the concrete
// hex/rgba values the doc documents and asserts they match. Resolving through
// an independent Tailwind-palette table (rather than re-asserting the same
// string) keeps the check non-circular: it proves the shade *choice* is right,
// not merely that a string was typed twice.

// The exact Tailwind v4 palette hexes for every shade the maps use. Sourced
// from the palette, cross-checked against the §2.5/§2.6 reference values.
const TW: Record<string, string> = {
  "sky-300": "#7dd3fc",
  "sky-400": "#38bdf8",
  "orange-300": "#fdba74",
  "orange-400": "#fb923c",
  "lime-300": "#bef264",
  "lime-400": "#a3e635",
  "violet-300": "#c4b5fd",
  "violet-400": "#a78bfa",
  "rose-300": "#fda4af",
  "rose-500": "#f43f5e",
  "yellow-300": "#fde047",
  "yellow-400": "#facc15",
  "red-500": "#ef4444",
  "amber-400": "#fbbf24",
};

// Semantic design tokens the maps lean on, with their resolved §2.3 hexes.
const TOKEN_HEX: Record<string, string> = {
  "text-secondary": "#B9C2BE", // --text-secondary
  "muted-foreground": "#8B958F", // --muted-foreground (shifted by the #909 audit)
};

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const n = hex.replace("#", "");
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

/** Resolve the `text-*` class in a badge string to its concrete sRGB channels. */
function resolveTextRgb(classString: string): Rgb {
  const arbitrary = classString.match(/text-\[#([0-9a-fA-F]{6})\]/);
  if (arbitrary) return hexToRgb(`#${arbitrary[1]}`);
  const palette = classString.match(/text-([a-z]+-\d+)/);
  if (palette && palette[1] in TW) return hexToRgb(TW[palette[1]]);
  const token = classString.match(/text-(text-secondary|muted-foreground)/);
  if (token) return hexToRgb(TOKEN_HEX[token[1]]);
  throw new Error(`no resolvable text-* class in "${classString}"`);
}

/** Resolve the `bg-*` tint in a badge string to sRGB channels + alpha. */
function resolveBgTint(classString: string): { rgb: Rgb; alpha: number } {
  const white = classString.match(/bg-white\/(\d+)/);
  if (white) return { rgb: { r: 255, g: 255, b: 255 }, alpha: Number(white[1]) / 100 };
  const palette = classString.match(/bg-([a-z]+-\d+)\/(\d+)/);
  if (palette && palette[1] in TW) {
    return { rgb: hexToRgb(TW[palette[1]]), alpha: Number(palette[2]) / 100 };
  }
  throw new Error(`no resolvable bg-* tint in "${classString}"`);
}

// §2.6 damage-type table: colored text + ~14%-alpha tint of the type's hue.
// Rebuild/Other are the neutral pair (--text-secondary on white/7).
const DAMAGE_26: Record<
  string,
  { text: string; tint: Rgb; tintAlpha?: number }
> = {
  water: { text: "#7DD3FC", tint: { r: 56, g: 189, b: 248 } },
  fire: { text: "#FDBA74", tint: { r: 251, g: 146, b: 60 } },
  mold: { text: "#BEF264", tint: { r: 163, g: 230, b: 53 } },
  storm: { text: "#C4B5FD", tint: { r: 167, g: 139, b: 250 } },
  biohazard: { text: "#FDA4AF", tint: { r: 244, g: 63, b: 94 } },
  contents: { text: "#FDE047", tint: { r: 250, g: 204, b: 21 } },
  rebuild: { text: "#B9C2BE", tint: { r: 255, g: 255, b: 255 }, tintAlpha: 0.07 },
  other: { text: "#B9C2BE", tint: { r: 255, g: 255, b: 255 }, tintAlpha: 0.07 },
};

describe("damageTypeColors — §2.6 default dark-tint map", () => {
  it("covers exactly the eight canonical Damage types", () => {
    expect(Object.keys(damageTypeColors).sort()).toEqual(
      Object.keys(DAMAGE_26).sort(),
    );
  });

  it.each(Object.entries(DAMAGE_26))(
    "%s resolves to its §2.6 text + ~14%% tint",
    (type, expected) => {
      const cls = damageTypeColors[type];
      expect(resolveTextRgb(cls)).toEqual(hexToRgb(expected.text));
      const tint = resolveBgTint(cls);
      expect(tint.rgb).toEqual(expected.tint);
      expect(tint.alpha).toBeCloseTo(expected.tintAlpha ?? 0.14, 2);
    },
  );
});

// §2.6 urgency maps to the semantic palette: emergency = danger (§2.5
// destructive), urgent = warning (§2.5), scheduled = neutral.
const URGENCY_26: Record<
  string,
  { text: string; tint: Rgb; tintAlpha?: number }
> = {
  emergency: { text: "#F09595", tint: { r: 239, g: 68, b: 68 } }, // destructive
  urgent: { text: "#FBBF24", tint: { r: 251, g: 191, b: 36 } }, // warning
  scheduled: { text: "#8B958F", tint: { r: 255, g: 255, b: 255 }, tintAlpha: 0.05 }, // neutral
};

describe("urgencyColors — §2.6 semantic-palette map", () => {
  it("covers exactly the three urgency values", () => {
    expect(Object.keys(urgencyColors).sort()).toEqual(
      Object.keys(URGENCY_26).sort(),
    );
  });

  it.each(Object.entries(URGENCY_26))(
    "%s resolves to its semantic text + tint",
    (urgency, expected) => {
      const cls = urgencyColors[urgency];
      expect(resolveTextRgb(cls)).toEqual(hexToRgb(expected.text));
      const tint = resolveBgTint(cls);
      expect(tint.rgb).toEqual(expected.tint);
      expect(tint.alpha).toBeCloseTo(expected.tintAlpha ?? 0.14, 2);
    },
  );

  it("uses tint treatment only — an alpha-modified bg, never a solid fill or ring", () => {
    for (const cls of Object.values(urgencyColors)) {
      expect(cls).not.toMatch(/\bring-/);
      expect(cls, `${cls} should carry an /alpha tint bg`).toMatch(/bg-[a-z0-9-]+\/\d+/);
    }
  });
});

// The label maps are the display-text half of the interface every current
// consumer imports; this slice restyles colors only and must not touch them.
describe("label maps — interface preserved for existing consumers", () => {
  it("keeps the eight canonical damage-type labels", () => {
    expect(damageTypeLabels).toEqual({
      water: "Water",
      fire: "Fire",
      mold: "Mold",
      storm: "Storm",
      biohazard: "Biohazard",
      contents: "Contents",
      rebuild: "Rebuild",
      other: "Other",
    });
  });

  it("keeps the three urgency labels", () => {
    expect(urgencyLabels).toEqual({
      emergency: "Emergency",
      urgent: "Urgent",
      scheduled: "Scheduled",
    });
  });

  it("keeps color and label keys aligned within each vocabulary", () => {
    expect(Object.keys(damageTypeColors).sort()).toEqual(
      Object.keys(damageTypeLabels).sort(),
    );
    expect(Object.keys(urgencyColors).sort()).toEqual(
      Object.keys(urgencyLabels).sort(),
    );
  });
});

// --card surface (§2.1) — the background the softened text must be legible on.
const CARD = "#111715";
const AA = 4.5;

function channelToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function contrast(hexA: string, hexB: string): number {
  const a = luminance(hexToRgb(hexA));
  const b = luminance(hexToRgb(hexB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

describe("soften — per-Organization damage-type color → theme-safe tint", () => {
  it("renders the stored bg as a ~14%-alpha tint", () => {
    // sky-400 stored bg → the §2.6 Water tint, regardless of the text tone.
    expect(soften("#38BDF8", "#0C447C").background).toBe("rgba(56, 189, 248, 0.14)");
  });

  // Representative stored text colors: whatever an org saves, the output tone
  // must be readable on the dark card.
  it.each([
    ["dark navy", "#0C447C"],
    ["dark brick", "#712B13"],
    ["saturated blue", "#0000FF"],
    ["pale wash", "#E6F1FB"],
    ["white", "#FFFFFF"],
    ["black", "#000000"],
    ["mid grey", "#808080"],
    ["low-sat warm grey", "#5F5E5A"],
  ])("lightens %s until its text tone clears WCAG AA on --card", (_name, stored) => {
    const { color } = soften("#E6F1FB", stored);
    expect(contrast(color, CARD)).toBeGreaterThanOrEqual(AA);
  });

  it("is pure — identical inputs yield deeply-equal output", () => {
    expect(soften("#38BDF8", "#0C447C")).toEqual(soften("#38BDF8", "#0C447C"));
  });

  it("is idempotent — re-softening an already-softened tone is a no-op", () => {
    const once = soften("#38BDF8", "#0C447C");
    const twice = soften("#38BDF8", once.color);
    expect(twice.color).toBe(once.color);
  });

  it("leaves an already-legible text color untouched", () => {
    // #7DD3FC (the §2.6 Water tone) already clears AA — it must survive intact.
    expect(soften("#38BDF8", "#7DD3FC").color).toBe("#7DD3FC");
  });

  it("preserves hue while lightening — dark navy becomes light blue, not white/grey", () => {
    const { color } = soften("#E6F1FB", "#0C447C");
    const { r, g, b } = hexToRgb(color);
    expect(b).toBeGreaterThan(r); // still blue-dominant
    expect(color).not.toBe("#FFFFFF"); // didn't collapse to white
  });
});

// ---------------------------------------------------------------------------
// resolveDamageTypeBadge / resolveStatusBadge — the §2.6 badge resolvers that
// the Jobs list wires in (#914). Each takes the config rows and returns a
// BadgeStyle: a Tailwind `className` for the vivid dark-tint default, or an
// inline `style` when a per-org color has to be softened to stay legible.
// ---------------------------------------------------------------------------

function makeDamageType(overrides: Partial<DamageType> = {}): DamageType {
  return {
    id: "dt-1",
    name: "water",
    display_label: "Water",
    bg_color: DEFAULT_DAMAGE_COLORS.water.bg,
    text_color: DEFAULT_DAMAGE_COLORS.water.text,
    icon: null,
    sort_order: 0,
    is_default: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeJobStatus(overrides: Partial<JobStatus> = {}): JobStatus {
  return {
    id: "st-1",
    name: "in_progress",
    display_label: "Active",
    bg_color: "#E1F5EE",
    text_color: "#085041",
    sort_order: 0,
    is_default: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveDamageTypeBadge (#914)", () => {
  it("uses the vivid §2.6 dark-tint class for an uncustomized canonical type", () => {
    // The seeded org default (bg/text still equal the seed) is the common case:
    // render the vivid class map, never a washed-out soften of a light hex.
    const badge = resolveDamageTypeBadge("water", [makeDamageType()]);

    expect(badge.className).toBe(damageTypeColors.water);
    expect(badge.style).toBeUndefined();
  });

  it("still treats a seed match as default despite hex casing drift", () => {
    // The DB could store the seed lower-cased; a case-sensitive compare would
    // mis-read that as a customization and soften it into a washed tint.
    const badge = resolveDamageTypeBadge("water", [
      makeDamageType({
        bg_color: DEFAULT_DAMAGE_COLORS.water.bg.toLowerCase(),
        text_color: DEFAULT_DAMAGE_COLORS.water.text.toLowerCase(),
      }),
    ]);

    expect(badge.className).toBe(damageTypeColors.water);
    expect(badge.style).toBeUndefined();
  });

  it("softens a hostile per-org override (white on white) to a legible tint", () => {
    // AC #2: a deliberately hostile custom color must stay legible on --card,
    // not fall back to the canonical sky class.
    const badge = resolveDamageTypeBadge("water", [
      makeDamageType({ bg_color: "#FFFFFF", text_color: "#FFFFFF" }),
    ]);

    expect(badge.className).toBeUndefined();
    expect(badge.style?.background).toBe("rgba(255, 255, 255, 0.14)");
    expect(contrast(badge.style!.color, CARD)).toBeGreaterThanOrEqual(AA);
  });

  it("softens a neon override rather than showing the canonical hue", () => {
    const badge = resolveDamageTypeBadge("water", [
      makeDamageType({ bg_color: "#39FF14", text_color: "#39FF14" }),
    ]);

    expect(badge.className).toBeUndefined();
    expect(badge.style?.background).toBe("rgba(57, 255, 20, 0.14)");
    expect(contrast(badge.style!.color, CARD)).toBeGreaterThanOrEqual(AA);
  });

  it("softens a non-canonical custom type that carries a stored color", () => {
    const badge = resolveDamageTypeBadge("asbestos", [
      makeDamageType({ name: "asbestos", bg_color: "#123456", text_color: "#ABCDEF" }),
    ]);

    expect(badge.style?.background).toBe("rgba(18, 52, 86, 0.14)");
    expect(badge.className).toBeUndefined();
  });

  it("falls back to the neutral pair for an unknown type with no stored color", () => {
    const badge = resolveDamageTypeBadge("asbestos", []);

    expect(badge.className).toBe(damageTypeColors.other);
    expect(badge.style).toBeUndefined();
  });
});

describe("resolveStatusBadge (#914)", () => {
  it("softens the config-driven status color — the source stays config (ADR 0022)", () => {
    // The badge is restyled into the tint treatment, but the color is still the
    // org's stored job_statuses color, not a substituted palette.
    const badge = resolveStatusBadge("in_progress", [
      makeJobStatus({ bg_color: "#123456", text_color: "#88CCFF" }),
    ]);

    expect(badge.className).toBeUndefined();
    expect(badge.style?.background).toBe("rgba(18, 52, 86, 0.14)");
    expect(contrast(badge.style!.color, CARD)).toBeGreaterThanOrEqual(AA);
  });

  it("softens the presentation-module seed before the config loads", () => {
    const seed = getJobStatusPresentation("in_progress").badge;
    const { r, g, b } = hexToRgb(seed.bg);
    const badge = resolveStatusBadge("in_progress", []);

    expect(badge.style?.background).toBe(`rgba(${r}, ${g}, ${b}, 0.14)`);
    expect(contrast(badge.style!.color, CARD)).toBeGreaterThanOrEqual(AA);
  });
});
