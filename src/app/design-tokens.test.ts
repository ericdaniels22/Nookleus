import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Token contract for design system v2 (docs/design-system.md §2, ADR 0027).
// The doc's hex/rgba values are the human-readable reference; globals.css
// authors them in oklch. This suite closes the loop: it parses the authored
// CSS, converts oklch back to sRGB, and asserts each mapping-table token
// resolves to its documented reference value.

const css = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** Extract the body of the first block opened by `selector` (brace-matched). */
function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`no "${selector}" block in globals.css`);
  const open = source.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(open + 1, i - 1);
}

function parseDeclarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    decls.set(m[1], m[2].trim());
  }
  return decls;
}

const rootDecls = parseDeclarations(extractBlock(css, ":root"));

function resolveToken(name: string, depth = 0): string {
  const raw = rootDecls.get(name);
  if (raw === undefined) throw new Error(`${name} is not defined in :root`);
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    if (depth > 4) throw new Error(`var() chain too deep at ${name}`);
    return resolveToken(ref[1], depth + 1);
  }
  return raw;
}

type Rgba = { r: number; g: number; b: number; alpha: number };

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

function parseNumber(raw: string): number {
  return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
}

/** oklch(L C H [/ A]) → sRGB 0–255 channels + alpha. */
function oklchToRgba(value: string): Rgba {
  const m = value.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  );
  if (!m) throw new Error(`not a parseable oklch() value: "${value}"`);
  const L = parseNumber(m[1]);
  const C = parseFloat(m[2]);
  const H = (parseFloat(m[3]) * Math.PI) / 180;
  const alpha = m[4] !== undefined ? parseNumber(m[4]) : 1;

  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const mm = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    alpha,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = hex.replace("#", "");
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

/** ±2/255 per channel absorbs 4-decimal oklch authoring precision. */
const CHANNEL_TOLERANCE = 2;

function expectTokenMatches(token: string, hex: string, alpha = 1) {
  const actual = oklchToRgba(resolveToken(token));
  const expected = hexToRgb(hex);
  const label = (channel: keyof typeof expected) =>
    `${token} ${String(channel)} (resolved ${actual.r},${actual.g},${actual.b} vs ${hex})`;
  expect(Math.abs(actual.r - expected.r), label("r")).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
  expect(Math.abs(actual.g - expected.g), label("g")).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
  expect(Math.abs(actual.b - expected.b), label("b")).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
  expect(actual.alpha, `${token} alpha`).toBeCloseTo(alpha, 2);
}

describe("design tokens — §2.0 mapping table resolves to documented reference values", () => {
  const OPAQUE: ReadonlyArray<readonly [string, string]> = [
    // §2.1 surfaces
    ["--background", "#0B0F0E"],
    ["--sidebar", "#0E1312"],
    ["--card", "#111715"],
    ["--muted", "#141A18"],
    ["--popover", "#1A211E"],
    // §2.3 text
    ["--foreground", "#E7ECEA"],
    ["--text-secondary", "#B9C2BE"],
    // Both shifted from the original draft values (#7A867F / #5E6A65) by
    // the §2.3 contrast audit; the doc's reference hexes were updated.
    ["--muted-foreground", "#8B958F"],
    ["--text-faint", "#79857F"],
    // §2.4 accent
    ["--primary", "#10B981"],
    ["--primary-foreground", "#052E22"],
    ["--accent-text", "#5EEAD4"],
    ["--ring", "#10B981"],
    ["--sidebar-accent-foreground", "#5EEAD4"],
    // §2.5 semantic
    ["--destructive", "#DC2626"],
    ["--warning", "#F59E0B"],
    // §2.7 charts
    ["--chart-1", "#10B981"],
    ["--chart-2", "#38BDF8"],
    ["--chart-3", "#FBBF24"],
    ["--chart-4", "#A78BFA"],
    ["--chart-5", "#F87171"],
  ];

  it.each(OPAQUE)("%s resolves to %s", (token, hex) => {
    expectTokenMatches(token, hex);
  });

  const TRANSLUCENT: ReadonlyArray<readonly [string, string, number]> = [
    // §2.2 borders
    ["--border", "#FFFFFF", 0.07],
    ["--border-subtle", "#FFFFFF", 0.05],
    ["--input", "#FFFFFF", 0.14],
    // §2.4 accent tint (+ active-nav tint on the sidebar slot)
    ["--accent-tint", "#10B981", 0.14],
    ["--sidebar-accent", "#10B981", 0.14],
    // §2.5 warning tint
    ["--warning-tint", "#FBBF24", 0.14],
  ];

  it.each(TRANSLUCENT)("%s resolves to %s at %d alpha", (token, hex, alpha) => {
    expectTokenMatches(token, hex, alpha);
  });
});

describe("design tokens — new tokens are registered in @theme inline (§2.0)", () => {
  const NEW_TOKENS = [
    "--border-subtle",
    "--text-secondary",
    "--text-faint",
    "--accent-text",
    "--accent-tint",
    "--warning",
    "--warning-tint",
  ];

  const themeBlock = extractBlock(css, "@theme inline");

  it.each(NEW_TOKENS)("%s is exposed as a color utility", (token) => {
    const utility = `--color-${token.slice(2)}`;
    expect(themeBlock).toMatch(
      new RegExp(`${utility}\\s*:\\s*var\\(${token}\\)`),
    );
  });
});

describe("dark-only migration — legacy palette is deleted (ADR 0027, §2.0)", () => {
  it("has no .dark class split", () => {
    expect(css).not.toMatch(/^\s*\.dark\s*\{/m);
  });

  const LEGACY_FAMILIES = [
    "--vibrant-",
    "--gradient-",
    "--shadow-card",
    "--shadow-vibrant",
    "--shadow-glow-primary",
  ];

  it.each(LEGACY_FAMILIES)("defines no %s* tokens", (prefix) => {
    expect(css).not.toContain(prefix);
  });

  const LEGACY_UTILITIES = [
    ".gradient-primary",
    ".gradient-secondary",
    ".gradient-accent",
    ".gradient-hero",
    ".gradient-surface",
    ".gradient-sidebar",
    ".gradient-text",
    ".card-vibrant",
    ".gradient-border",
  ];

  it.each(LEGACY_UTILITIES)("ships no %s utility class", (cls) => {
    expect(css).not.toContain(`${cls} {`);
    expect(css).not.toContain(`${cls}:`);
    expect(css).not.toContain(`${cls}::`);
  });

  it("keeps dark: variants applying unconditionally during migration (always-on bridge)", () => {
    // Removing @custom-variant entirely would make dark: fall back to
    // prefers-color-scheme. The bridge pins it on until step-18 cleanup
    // folds the remaining dark: styles into base styles.
    expect(css).toMatch(/@custom-variant dark \(&\);/);
    expect(css).not.toContain(".dark *");
  });
});

describe("contrast audit — §2.3 small text vs --card meets WCAG AA", () => {
  function srgbChannelToLinear(v: number): number {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance({ r, g, b }: Rgba): number {
    return (
      0.2126 * srgbChannelToLinear(r) +
      0.7152 * srgbChannelToLinear(g) +
      0.0722 * srgbChannelToLinear(b)
    );
  }

  function contrastRatio(fgToken: string, bgToken: string): number {
    const fg = relativeLuminance(oklchToRgba(resolveToken(fgToken)));
    const bg = relativeLuminance(oklchToRgba(resolveToken(bgToken)));
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return (hi + 0.05) / (lo + 0.05);
  }

  // Smallest specified sizes are 12px (--muted-foreground metadata) and
  // 11px (--text-faint eyebrows) — both normal text, so AA requires 4.5:1.
  it.each([["--muted-foreground"], ["--text-faint"]])(
    "%s on --card is at least 4.5:1",
    (token) => {
      expect(contrastRatio(token, "--card")).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("radius scale — §4 derives from --radius, not per-component hardcoding", () => {
  const REM = 16;

  function radiusStepPx(step: string): number {
    const themeBlock = extractBlock(css, "@theme inline");
    const decl = parseDeclarations(themeBlock).get(`--radius-${step}`);
    if (!decl) throw new Error(`--radius-${step} not registered`);
    const base = parseFloat(resolveToken("--radius")) * REM;
    if (decl === "var(--radius)") return base;
    const m = decl.match(/^calc\(var\(--radius\)\s*\*\s*([\d.]+)\)$/);
    if (!m) throw new Error(`--radius-${step} is not derived from --radius: "${decl}"`);
    return base * parseFloat(m[1]);
  }

  it.each([
    ["md", 8], // inputs and buttons
    ["lg", 10], // cards and widgets
    ["xl", 12], // dialogs
  ])("--radius-%s computes to %dpx", (step, px) => {
    expect(radiusStepPx(step)).toBeCloseTo(px, 1);
  });
});

describe("iOS/desktop globals — §7.4 applies globally, not per-page", () => {
  it.each([
    ["color-scheme: dark (native controls render dark)", /color-scheme:\s*dark/],
    ["transparent tap highlight", /-webkit-tap-highlight-color:\s*transparent/],
    ["overscroll containment on the shell", /overscroll-behavior:\s*none/],
    ["WebKit autofill override", /input:-webkit-autofill/],
    [
      "16px minimum form-control default (iOS auto-zoom)",
      /input,\s*\n?\s*select,\s*\n?\s*textarea\s*\{[^}]*font-size:\s*16px/,
    ],
  ])("globals.css sets %s", (_rule, pattern) => {
    expect(css).toMatch(pattern);
  });

  it("ships no 100vh or *-screen viewport-height utilities anywhere in src", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!/\.(tsx?|css)$/.test(name) || name.includes(".test.")) continue;
      const path = join(entry.parentPath, name);
      const source = readFileSync(path, "utf8");
      if (source.includes("100vh") || source.includes("h-screen")) {
        offenders.push(path);
      }
    }
    expect(offenders, "files still using 100vh/h-screen (use dvh — §7.4)").toEqual([]);
  });
});

describe("legacy custom properties — app-wide sweep (#909)", () => {
  it("references no deleted legacy vars anywhere in src", () => {
    const deleted =
      /var\(--(?:gradient-|shadow-card|shadow-vibrant|shadow-glow|vibrant-)/;
    const offenders: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!/\.(tsx?|css)$/.test(name) || name.includes(".test.")) continue;
      const path = join(entry.parentPath, name);
      const source = readFileSync(path, "utf8");
      if (deleted.test(source)) {
        offenders.push(path);
      }
    }
    expect(
      offenders,
      "these vars were deleted from globals.css and now render as nothing",
    ).toEqual([]);
  });

  it("references no deleted legacy utility classes anywhere in src", () => {
    // (?<!-) keeps runtime setProperty("--gradient-…") strings out of scope —
    // setting an unread var is dead code, not a broken render.
    const deleted =
      /(?<!-)\b(?:gradient-hero|gradient-surface|gradient-sidebar|gradient-text|gradient-primary|gradient-secondary|gradient-accent|gradient-border|card-vibrant)\b/;
    const offenders: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      const path = join(entry.parentPath, name);
      const source = readFileSync(path, "utf8");
      if (deleted.test(source)) {
        offenders.push(path);
      }
    }
    expect(
      offenders,
      "these classes were deleted from globals.css and now render as nothing",
    ).toEqual([]);
  });
});

describe("theme system removal — dark-only, no runtime switching (ADR 0027)", () => {
  it("ships no next-themes imports anywhere in src", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      const path = join(entry.parentPath, name);
      const source = readFileSync(path, "utf8");
      if (source.includes("next-themes")) {
        offenders.push(path);
      }
    }
    expect(
      offenders,
      "files still importing next-themes (dark-only — ADR 0027)",
    ).toEqual([]);
  });

  it("declares no next-themes dependency in package.json (step 18 cleanup)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(
      Object.keys(declared).filter((name) => name === "next-themes"),
      "next-themes was deferred from step 1 (ADR 0027) — drop it at step 18",
    ).toEqual([]);
  });
});

describe("hardcoded-color sweep — step 18 owned surfaces (#926)", () => {
  // The final migration sweep (docs/design-system.md §8 step 18) closes on the
  // surfaces no earlier pass owns: the unauthenticated auth chrome (login,
  // set-password, logout), the trash chrome, and the global error/not-found
  // pages. These must be tokens-only — unlike the Jobs-list warning tint, which
  // deliberately spells the token hexes as bg-amber-400/14 / bg-amber-500
  // (#914), there is no reason for a raw palette color on these surfaces.
  //
  // Predecessor steps 5, 10, 11, 13, 15, 16 have now merged, so the sweep goes
  // cross-cutting (guards A and B below) without re-flagging the *sanctioned*
  // §2.6 badge idiom — tint bg + colored text (bg-sky-400/14 text-sky-300, and
  // the text-[#F09595] danger tone in badge-colors.ts).
  const OWNED_DIRS = [
    "src/app/login",
    "src/app/logout",
    "src/app/set-password",
    "src/components/trash",
  ];
  const OWNED_FILES = ["src/app/error.tsx", "src/app/not-found.tsx"];

  /** Drop comments so issue refs like `#386` don't read as a hex color. The
   *  `[^:]` guard keeps `https://` URLs from being mistaken for line comments. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }

  const PALETTE =
    "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|" +
    "emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
  const UTILITY =
    "bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|" +
    "outline|decoration|accent|caret|placeholder|shadow";
  const OFFENDER = new RegExp(
    `\\b(?:${UTILITY})-(?:${PALETTE})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b` +
      `|#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b` +
      `|\\b(?:rgb|rgba|hsl|hsla)\\(`,
    "g",
  );

  function ownedSourceFiles(): string[] {
    const files: string[] = [];
    for (const dir of OWNED_DIRS) {
      const abs = resolve(process.cwd(), dir);
      for (const entry of readdirSync(abs, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (!/\.(tsx?|css)$/.test(name) || name.includes(".test.")) continue;
        files.push(join(entry.parentPath, name));
      }
    }
    for (const f of OWNED_FILES) files.push(resolve(process.cwd(), f));
    return files;
  }

  it("uses only design tokens — no Tailwind palette, hex, or rgb/hsl colors", () => {
    const offenders: string[] = [];
    for (const path of ownedSourceFiles()) {
      const source = stripComments(readFileSync(path, "utf8"));
      const matches = source.match(OFFENDER);
      if (matches) {
        offenders.push(`${path}: ${[...new Set(matches)].join(", ")}`);
      }
    }
    expect(
      offenders,
      "step-18 surfaces must be tokens-only (§2.0) — use --warning/--warning-tint, not raw amber",
    ).toEqual([]);
  });

  // Guard A — repo-wide. The `--vibrant-*` palette was deleted in step 1
  // (ADR 0027), so any `*-vibrant-*` utility resolves to nothing: a dead relic,
  // never legitimate. Safe to ban everywhere because `vibrant` is not a real
  // Tailwind hue (the CVA `vibrant` *variant key* in ui/badge.tsx is an alias,
  // not a utility, so it never matches this pattern).
  const VIBRANT_UTILITY = new RegExp(`\\b(?:${UTILITY})-vibrant-[a-z]+\\b`, "g");

  function allSourceFiles(): string[] {
    const files: string[] = [];
    const root = resolve(process.cwd(), "src");
    for (const entry of readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!/\.(tsx?|css)$/.test(name) || name.includes(".test.")) continue;
      files.push(join(entry.parentPath, name));
    }
    return files;
  }

  it("uses no dead `*-vibrant-*` utilities anywhere in src (deleted step 1)", () => {
    const offenders: string[] = [];
    for (const path of allSourceFiles()) {
      const matches = stripComments(readFileSync(path, "utf8")).match(
        VIBRANT_UTILITY,
      );
      if (matches) {
        offenders.push(
          `${relative(process.cwd(), path)}: ${[...new Set(matches)].join(", ")}`,
        );
      }
    }
    expect(
      offenders,
      "`--vibrant-*` was removed in step 1 — these classes render nothing (§2.7 uses --chart-1…5)",
    ).toEqual([]);
  });

  // Guard B — app-chrome surfaces this sweep migrates. Plain chrome only (no
  // §2.6 badge idiom), so the strict OFFENDER scan applies with no exemption.
  // Config-driven inline styles (e.g. a per-org damage_types.bg_color) are
  // values, not literals, so they never match. Third-party *brand* colors
  // (QuickBooks green, Google blue, social-platform hues) are a documented
  // exemption per the #926 sweep decision and are deliberately excluded.
  const SWEPT_FILES = [
    "src/components/activity-timeline.tsx",
    "src/components/notification-bell.tsx",
    "src/components/email/job-email-row.tsx",
    "src/components/job-detail/review-request-section.tsx",
    "src/components/job-detail/collection-ring.tsx",
    "src/components/expenses/expenses-section.tsx",
    "src/components/expenses/log-expense-modal.tsx",
    "src/components/job-cover-picker.tsx",
  ];

  it("swept app-chrome files are tokens-only — no palette, hex, or rgb/hsl", () => {
    const offenders: string[] = [];
    for (const rel of SWEPT_FILES) {
      const source = stripComments(
        readFileSync(resolve(process.cwd(), rel), "utf8"),
      );
      const matches = source.match(OFFENDER);
      if (matches) {
        offenders.push(`${rel}: ${[...new Set(matches)].join(", ")}`);
      }
    }
    expect(
      offenders,
      "swept chrome must be tokens-only — map to --chart-*/--warning/--accent-*, not raw colors",
    ).toEqual([]);
  });
});
