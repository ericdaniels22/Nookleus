# Signature Pad — Thicker Draw Stroke + Type Mode

**Date:** 2026-05-07
**Build:** 15f (post-15d, pre/parallel to 15e/25b)
**Author:** Eric (designed via brainstorming session with Claude Code)

## Problem

The contract signing flow added in [[build-15d]] ships a single signature input mode (canvas drawing) at `src/components/contracts/signature-pad-modal.tsx`. Two real-world gaps surfaced after Jadon Daniels' first prod-signed contract on 2026-05-07:

1. **Stroke too thin** — `lineWidth = 2` produces a faint signature that looks underweight when stamped onto the PDF, especially on retina displays where the rendered PNG is downsampled into the PDF.
2. **No Type mode** — customers signing on a desktop without a touch device or stylus end up with a clumsy mouse-drawn signature. Industry e-sign tools (HelloSign, DocuSign, PandaDoc) all expose a typed-name fallback rendered in a script font.

## Goals

- Increase draw stroke weight + smooth out polyline kinks at higher widths.
- Add a "Type" tab that lets the customer type their name and have it rendered in a script font, output as PNG identical in shape to the Draw output.
- Add the standard ESIGN-aligned legal disclaimer ("I understand this is a legal representation of my signature.") to the modal footer.
- **Zero changes to the backend signing path** (`/api/sign/[token]`, `/api/contracts/in-person`, `src/lib/contracts/stamp-pdf.ts`). Both tabs emit a PNG dataUrl through the existing `onConfirm(dataUrl: string)` contract.

## Non-Goals

- Upload tab (image of an existing signature) — deferred. Users wanting this can fall back to Draw with a stylus on tablet.
- Saved signatures (recall a previously-used sig per signer) — deferred; requires DB column + per-signer storage + signer-recall logic.
- Multi-font picker ("Change font" cycle) — single font is sufficient and removes UI clutter.
- Server-side text-to-PDF rendering at stamp time. Out of scope; would require font-file embedding in `pdf-lib`, contract-shape widening, and divergent stamp paths.

## User-facing changes

A signing customer opening the signature dialog now sees:

```
┌──────────────────────────────────────────────────────┐
│ Sign as <signer name>                              X │
│                                                      │
│  [ Draw ]  [ Type ]                                  │
│  ─────────────────────────────────────────────       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │            (canvas or typed preview)           │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Clear (draw mode only)                              │
│                                                      │
│  I understand this is a legal representation        │
│  of my signature.       [ Cancel ] [ Insert ]       │
└──────────────────────────────────────────────────────┘
```

- **Draw tab** (default): same canvas as today, but stroke is thicker and curves are smooth.
- **Type tab**: text `<input>` + live HTML preview rendered in Caveat (Google Fonts cursive face). Insert disabled until input is non-empty after `.trim()`.
- **Disclaimer text** sits flush-left in the footer next to Cancel + Insert buttons. Implicit consent on Insert click — no explicit checkbox. Matches HelloSign / DocuSign / PandaDoc industry norm. ESIGN Act does not require an explicit checkbox.

## Architecture

### File scope

Only one file changes: `src/components/contracts/signature-pad-modal.tsx` (currently 123 lines, grows to ~200).

`src/components/contracts/contract-signer-view.tsx` (the only caller) does **not** change. The `onConfirm(dataUrl: string)` contract is preserved — both tabs emit a PNG dataUrl in the same shape (600×200 px, white background, black ink/text on a transparent baseline).

### Component shape

```ts
type Tab = "draw" | "type";

const [tab, setTab] = useState<Tab>("draw");
const [hasInk, setHasInk] = useState(false);
const [typedName, setTypedName] = useState("");
const lastPointRef = useRef<{ x: number; y: number } | null>(null);
```

Tab-bar at the top of the dialog body (above the canvas/preview area). Switching tabs **does not** clear the other tab's state — the user can flip back and forth without losing work.

Insert button uses whichever tab is active:
- Draw tab → `canvasRef.current.toDataURL('image/png')` (existing behavior).
- Type tab → fresh offscreen 600×200 canvas, `ctx.fillText(typedName, ...)` in Caveat, `toDataURL('image/png')`.

### Font loading

Caveat is loaded once at module top via `next/font/google`:

```ts
import { Caveat } from "next/font/google";
const caveat = Caveat({ subsets: ["latin"], display: "swap", weight: "400" });
```

`caveat.className` is applied to the live HTML preview node so the user sees what they're about to insert, in the same font that the canvas will render. The font face is registered in `document.fonts`, so `ctx.font = "60px Caveat, cursive"` on the offscreen canvas resolves to the same face.

**Font-load race guard**: before the offscreen draw runs, `await document.fonts.load('60px Caveat')` ensures the face is loaded — otherwise the canvas may rasterize using the fallback `cursive` system font. Pre-warm the load on modal open as well so by the time the user has typed and clicked Insert, the face is already in cache.

### Auto-shrink for long names

A 600 px canvas with 60 px Caveat fits roughly 22 characters before overflowing. Long names get an auto-shrink loop:

```ts
ctx.font = `${size}px Caveat, cursive`;
while (ctx.measureText(typedName).width > 560 && size > 28) {
  size -= 4;
  ctx.font = `${size}px Caveat, cursive`;
}
```

Floor at 28 px (still legible). 20 px of horizontal padding each side. Result: any realistic name fits the canvas; pathological 50+-char inputs render at the floor size and may still overflow but render visibly.

### Quadratic-curve smoothing for Draw mode

Current `move()` does `ctx.lineTo(x, y); ctx.stroke()` per pointer event — visible polyline kinks at thicker stroke widths. Replace with quadratic interpolation between consecutive points (standard `signature_pad`-library smoothing pattern):

```ts
function move(e: React.PointerEvent<HTMLCanvasElement>) {
  if (!drawingRef.current) return;
  const ctx = canvasRef.current?.getContext("2d");
  if (!ctx) return;
  const { x, y } = pos(e);
  const last = lastPointRef.current;
  if (last) {
    const midX = (last.x + x) / 2;
    const midY = (last.y + y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
  }
  lastPointRef.current = { x, y };
  setHasInk(true);
}
```

`down()` initialises `lastPointRef = { x, y }` and starts a fresh path. `up()` clears `lastPointRef = null` so the next stroke does not curve away from the previous one's endpoint.

### Stroke config bumps

In the `useEffect` that initializes the canvas:

```diff
- ctx.lineWidth = 2;
+ ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
+ ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
```

`lineJoin = "round"` smooths the corners where quadratic curves meet at higher widths.

### Disclaimer footer

The current footer holds Clear (left) + Cancel/Confirm (right). New shape:

- **Draw tab**: Clear button sits in its own row above the disclaimer footer.
- **Type tab**: no secondary-actions row. Clearing the typed input is a single keystroke (delete / select-all + delete) — a Clear button would be redundant UI.
- **Disclaimer footer** (always shown, both tabs): disclaimer text flush-left, Cancel + Insert buttons flush-right.

Disclaimer copy is exactly: `I understand this is a legal representation of my signature.`

The Confirm button is renamed to **Insert** to match HelloSign vocabulary and reinforce that this completes the signature insertion, not the entire contract submission.

### Disabled-state rules

- Draw tab: Insert disabled until `hasInk === true`.
- Type tab: Insert disabled until `typedName.trim().length > 0`.

Switching tabs re-evaluates the disabled state against the active tab's content.

### Tab a11y

```html
<div role="tablist" aria-label="Signature input mode">
  <button role="tab" aria-selected={tab === "draw"} aria-controls="draw-panel">Draw</button>
  <button role="tab" aria-selected={tab === "type"} aria-controls="type-panel">Type</button>
</div>
<div role="tabpanel" id="draw-panel" hidden={tab !== "draw"}>...</div>
<div role="tabpanel" id="type-panel" hidden={tab !== "type"}>...</div>
```

Standard tab pattern. Keyboard navigation falls out of native `<button>` semantics — left/right arrow handling is **not** added in v1 (out of scope; tab + enter still works).

## Data flow

```
User opens modal
  └─ Caveat font face begins loading (next/font/google self-host)
  └─ tab = "draw" by default

[ Draw tab path ]
  User strokes canvas
    └─ down/move/up → quadratic-smoothed strokes onto canvasRef
    └─ hasInk = true on first move
  User clicks Insert
    └─ canvasRef.current.toDataURL('image/png')
    └─ onConfirm(dataUrl) → SignerView state
    └─ onClose()

[ Type tab path ]
  User types in <input>
    └─ setTypedName(value)
    └─ live HTML preview re-renders in caveat.className
  User clicks Insert
    └─ await document.fonts.load('60px Caveat')
    └─ Create offscreen <canvas width=600 height=200>
    └─ Fill white bg
    └─ Auto-shrink font-size loop until measureText.width < 560
    └─ ctx.fillText(typedName, centerX, centerY) with textBaseline="middle", textAlign="center"
    └─ canvas.toDataURL('image/png')
    └─ onConfirm(dataUrl) → SignerView state (identical contract to Draw)
    └─ onClose()
```

The downstream signer-view, server `/api/sign/[token]` POST, `stampPdf` call, and `pdf-lib` overlay onto the contract PDF are **identical** in both paths. Server cannot distinguish typed from drawn signatures — both are PNG bytes.

## Backward compatibility

- Existing signed contracts in production (`92a41190` Jadon Daniels' WTR signed 2026-05-07 15:14 UTC, plus the 15d test-pass contracts that were cleaned up but whose stamping logic was validated) used the Draw path. Their stamp coordinates and PNG dimensions are unchanged.
- The `onConfirm` callback contract is preserved — `(dataUrl: string) => void` where `dataUrl` is a `data:image/png;base64,...` string.
- No DB schema changes. No RPC changes. No API route changes. No `stamp-pdf.ts` changes.

## Error handling

| Failure | Behavior |
|---|---|
| Caveat fails to load (network blocked, etc.) | `document.fonts.load` resolves with the registered face slot regardless; if the face genuinely never resolves, the canvas falls back to the system `cursive` font. Signature still renders, just in a less-attractive font. No user-visible error. |
| Type input is whitespace-only | Insert button stays disabled (`.trim().length > 0` check). |
| User clicks Insert in Draw tab without drawing | Insert button stays disabled (`hasInk === false`). |
| Browser doesn't support `document.fonts.load` (very old) | Promise reject is caught silently; render proceeds with whatever font is currently available. |
| Canvas `toDataURL` throws (extremely rare; would require canvas tainting which doesn't apply here) | Catch + toast error, leave modal open. Today's code doesn't catch this either; v1 matches today's behavior. |

## Testing

### Manual test plan

1. **Draw tab smoke test**: open the modal, draw a signature with mouse on desktop, verify stroke is visibly thicker than today's 2 px line and curves are smooth (no polyline kinks). Insert. Verify the signature renders into the contract PDF page at the expected coordinates.
2. **Type tab smoke test**: open the modal, switch to Type, type "Eric Daniels", verify the live HTML preview renders in cursive script. Insert. Send a real contract through to a test recipient via Resend, sign, open the stamped PDF, verify the cursive signature is stamped onto page 5 at the same coordinates as a drawn signature would have been.
3. **Long-name shrink test**: in Type tab, type "Christopher Anderson-Whitfield-Jr". Verify the live preview and the stamped output both render the full name without overflow (font shrinks to fit).
4. **Tab switch preservation**: in Type tab, type "Eric Daniels". Switch to Draw tab. Switch back to Type tab. Verify "Eric Daniels" is still in the input.
5. **Disabled-state**: open modal in Draw tab, click Insert without drawing — should be disabled. Switch to Type tab, click Insert with empty input — should be disabled. Type one character — Insert enables.
6. **Mobile / responsive**: open the modal on a phone-width viewport, verify the tabs render legibly, the canvas is responsive, the disclaimer text wraps cleanly, and both tab paths work end-to-end via finger/touch.
7. **Disclaimer copy**: verify the footer reads exactly "I understand this is a legal representation of my signature." (no typos).

### Automated coverage

No automated tests. The existing modal has none, and the dialog interaction is hard to drive in unit tests without a real browser. Manual smoke is sufficient for v1; if regression risk emerges, add a Playwright E2E in a future build.

## Out of scope (deferred)

- **Upload tab** — deferred unless customers ask.
- **Saved signatures** — deferred; would need a DB column + per-signer recall.
- **Font picker** — deferred; single Caveat is sufficient. If demand emerges, swap to a 3-font cycle (Caveat / Dancing Script / Sacramento) — small additive change.
- **Stylus pressure sensitivity** — Pointer Events expose `e.pressure` but standardising it across mouse/touch/stylus is browser-dependent and adds complexity disproportionate to the polish gain.
- **Server-side text→PDF rendering at stamp time** — explicitly rejected per Architecture section.
- **Keyboard arrow navigation between tabs** — out of scope; Tab + Enter works.

## Open questions

None at design close. All four clarifying questions answered during brainstorming:

1. Tab scope → Draw + Type only.
2. Stroke thickness → bump to 3.5 + add quadratic-curve smoothing.
3. Type-mode font → single font (Caveat), no picker.
4. Disclaimer copy + gating → HelloSign verbatim, always shown, no checkbox.

## References

- Existing component: `src/components/contracts/signature-pad-modal.tsx`
- Sole caller: `src/components/contracts/contract-signer-view.tsx:219`
- Server-side stamp path (unchanged): `src/lib/contracts/stamp-pdf.ts`, `src/app/api/sign/[token]/route.ts`
- First real prod sig validating the underlying flow: `92a41190` Jadon Daniels, `WTR-2026-0020`, signed 2026-05-07 15:14 UTC
- Industry reference: HelloSign signature dialog (screenshots in brainstorming session)
- Standard smoothing reference: `signature_pad` library's quadratic-Bézier midpoint pattern
