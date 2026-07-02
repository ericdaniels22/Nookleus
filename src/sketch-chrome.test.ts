import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Sketch chrome pass (#925; docs/design-system.md §8 step 17, guardrail §9.3).
// The toolbars, floor tabs, room/object inspectors, statistics tiles, the
// zoom pill, and the access-restricted card around the Sketch builder render on
// the dark tokens (§2): no 6-digit hex literals, no named Tailwind palette
// utilities (gray/blue/red/emerald/…), no opaque black/white *surface* fills.
//
// Guardrail §9.3: the 2D plan canvas (`plan-canvas.tsx`) and the three.js
// dollhouse (`sketch-3d-viewer.tsx`) are OUT of scope — their render colours are
// scene constants by necessity (a dark token would change what the canvas paints,
// not just its chrome). Those files are NOT pinned here; the second block instead
// asserts the reskin left their constants intact, so a stray class swap can't
// bleed across the guardrail.
//
// This suite pins the chrome files the same way photos-chrome.test.ts pins the
// Photos surface and native-shell-chrome.test.ts pins the Capacitor config.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// Drop comments so issue refs (`#925`, `#890`) and colour names in prose never
// read as hardcoded colours. The `(^|\s)` guard leaves `https://` (preceded by
// `:`) alone; className strings never contain `//`.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const HEX = /#[0-9a-fA-F]{6}\b/g;
const NAMED_PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|shadow|caret|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{1,3})?(?:\/\d{1,3})?\b/g;
// Opaque black/white *surface* fills must become tokens. `text-black`/`text-white`
// (foreground over media) and any `/alpha` variant (a media wash) are allowed.
const OPAQUE_BW_SURFACE =
  /\b(?:bg|border|from|to|via|fill|divide|ring|outline|shadow)-(?:black|white)\b(?!\/)/g;

function offenders(src: string): string[] {
  const code = stripComments(src);
  return [
    ...(code.match(HEX) ?? []),
    ...(code.match(NAMED_PALETTE) ?? []),
    ...(code.match(OPAQUE_BW_SURFACE) ?? []),
  ];
}

// Chrome files reskinned in this step. The entire on-screen UI of the Sketch
// builder lives in these three: the route entry (auth guard + access-restricted
// card), the editor shell (top bar, floor tabs, 2D/3D toggle, object palette,
// room/object inspectors, wall/opening/measure tiles, zoom pill, 3D loading
// state), and the statistics tiles it renders in its aside.
const CHROME_FILES = [
  "src/app/jobs/[id]/sketch/page.tsx",
  "src/components/plan-editor.tsx",
  "src/components/statistics-panel.tsx",
];

describe("Sketch chrome renders on dark tokens (#925, design-system §8 step 17)", () => {
  it.each(CHROME_FILES)("%s uses tokens, not hardcoded colors", (file) => {
    expect(offenders(read(file))).toEqual([]);
  });
});

// Guardrail §9.3 — the 2D plan canvas and the three.js dollhouse are hands-off.
// These files legitimately carry hardcoded render colours; this block asserts the
// chrome reskin did NOT strip or change them (the inverse of the pins above), so
// the guardrail is enforced, not merely trusted.
describe("Sketch canvas + 3D view stay untouched (#925, guardrail §9.3)", () => {
  it("keeps the 2D plan-canvas Fabric render constants", () => {
    const canvas = read("src/components/plan-canvas.tsx");
    expect(canvas).toContain('WALL_STROKE = "#111827"');
    expect(canvas).toContain('GRID_DOT = "#cbd5e1"');
  });

  it("keeps the three.js dollhouse scene colours", () => {
    const viewer = read("src/components/sketch-3d-viewer.tsx");
    expect(viewer).toContain('args={["#0b0f14"]}');
    expect(viewer).toContain('color="#cbd5e1"');
  });
});
