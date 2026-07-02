import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Photos chrome + native capture-flow chrome reskin (#916; docs/design-system.md
// §7.6, §8, guardrail §9.2). Every surface, button, toolbar, and sheet around
// the photo grid / viewer / annotator / camera renders on the dark tokens (§2):
// no 6-digit hex literals, no named Tailwind palette utilities (gray/blue/red/
// emerald/…).
//
// One carve-out — media overlay. A translucent black/white wash sitting over a
// photo or the live camera feed (this is what the restyled dialog/sheet overlays
// already use: `bg-black/40`), and white/black *text* for legibility over that
// media, are allowed. Opaque black/white *surfaces* (`bg-white` cards, `bg-black`
// screens) are not — those are theme surfaces and must be tokens.
//
// This suite pins the chrome files the same way design-tokens.test.ts pins
// globals.css and native-shell-chrome.test.ts pins the Capacitor config.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// Drop comments so issue refs (`#916`) and colour names in prose never read as
// hardcoded colours. The `(^|\s)` guard leaves `https://` (preceded by `:`)
// alone; className strings never contain `//`.
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

// Chrome files reskinned in this step. The photo annotator is handled separately
// below because only its JSX chrome region is in scope — the Fabric.js canvas
// classes and logic above are guardrail-protected (§9.2).
const CHROME_FILES = [
  "src/app/photos/page.tsx",
  "src/components/photo-viewer.tsx",
  "src/components/job-photos-tab.tsx",
  "src/components/photo-upload.tsx",
  "src/components/mobile/camera-view.tsx",
  "src/components/mobile/review-screen.tsx",
  "src/components/mobile/capture-fab.tsx",
  "src/components/mobile/upload-queue-sheet.tsx",
  "src/components/mobile/upload-queue-badge.tsx",
  "src/app/(mobile)/jobs/[id]/capture/capture-flow.tsx",
];

describe("Photos chrome renders on dark tokens (#916, design-system §7.6/§8)", () => {
  it.each(CHROME_FILES)("%s uses tokens, not hardcoded colors", (file) => {
    expect(offenders(read(file))).toEqual([]);
  });
});

// The photo annotator is one file with two regions split by an explicit
// sentinel: everything below is JSX chrome (reskinned here); everything above
// is the Fabric.js canvas + drawing logic that guardrail §9.2 forbids touching.
const ANNOTATOR = "src/components/photo-annotator.tsx";
const CHROME_SENTINEL = "// #916 chrome region";

describe("photo annotator — chrome reskinned, Fabric canvas untouched (#916, §9.2)", () => {
  const src = read(ANNOTATOR);
  const idx = src.indexOf(CHROME_SENTINEL);

  it("marks the chrome/canvas boundary with the #916 sentinel", () => {
    expect(idx).toBeGreaterThan(0);
  });

  it("renders the JSX chrome below the sentinel on dark tokens", () => {
    // Colour swatches and the thickness preview paint annotation *data* colours
    // via inline style={{ backgroundColor: … }}, not class utilities, so the
    // class/hex scans don't reach them.
    expect(offenders(src.slice(idx))).toEqual([]);
  });

  it("leaves the Fabric drawing constants above the sentinel intact", () => {
    const fabric = src.slice(0, Math.max(idx, 0));
    expect(fabric).toContain('GUIDE_COLOR = "#22D3EE"');
    expect(fabric).toContain('"#F59E0B"'); // arrow default / annotation colour
    expect(fabric).toContain('backgroundColor: "#1a1a1a"'); // initCanvas pixels
  });
});
