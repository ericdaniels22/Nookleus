# Signature Pad — Thicker Draw + Type Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `SignaturePadModal` so the Draw mode strokes are thicker + smoother and a new Type mode lets the customer type their name in a script font, both producing identical PNG output through the existing `onConfirm(dataUrl)` contract — zero backend changes.

**Architecture:** Single-file modification to `src/components/contracts/signature-pad-modal.tsx`. Tabbed dialog (Draw / Type). Draw tab keeps the current canvas with bumped `lineWidth=3.5` + quadratic-curve midpoint smoothing. Type tab renders a live HTML preview in Caveat (Google Font via `next/font/google`); on Insert, draws the typed name onto an offscreen 600×200 canvas and exports `image/png`. Disclaimer footer ("I understand this is a legal representation of my signature.") shown in both tabs. Sole caller `contract-signer-view.tsx:219` is unchanged.

**Tech Stack:** React 19, Next.js (per AGENTS.md, this is a non-standard build — APIs may differ from training data), `next/font/google` (already used in `src/app/layout.tsx` for Inter), HTML5 Canvas 2D, base-ui Dialog primitive (already used by current modal via `@/components/ui/dialog`).

**Spec:** `docs/superpowers/specs/2026-05-07-signature-pad-type-mode-design.md` (commit `669996d`)

**Note on testing:** The spec explicitly opts out of automated tests for this work — dialog/canvas interactions are hard to drive without a real browser, and the existing modal has no test coverage. Manual smoke is the verification step. This is documented in the spec under "Automated coverage."

---

## File Structure

**Single file modified:**
- `src/components/contracts/signature-pad-modal.tsx` (123 → ~210 lines)

**No other files touched.** No new dependencies. No backend changes. No type changes. No DB / RPC / API route changes. The sole caller (`src/components/contracts/contract-signer-view.tsx:219`) does not change because the `onConfirm(dataUrl: string) => void` contract is preserved.

**Caveat font** is loaded via `next/font/google`, same pattern as `Inter` in `src/app/layout.tsx:2`. No font files committed to the repo — Google Fonts self-hosting is built into Next.

---

## Task 1: Replace `signature-pad-modal.tsx` with the upgraded component

**Files:**
- Modify: `src/components/contracts/signature-pad-modal.tsx` (full rewrite, 123 → ~210 lines)

This is a single coherent rewrite — every change in the spec lives in this one file and they are tightly interdependent (tab state gates which canvas is read at Insert time, disclaimer footer wraps both tabs, font-loading affects both the live preview and the offscreen render). Splitting into multiple commits inside one file would create intermediate broken states. We make the full change in one task, manually smoke-test it (Task 2), then commit (Task 3).

- [ ] **Step 1: Read the current file to confirm its exact starting state**

Run: `cat src/components/contracts/signature-pad-modal.tsx`

Expected: 123-line file matching the snapshot in the spec. The component imports from `@/components/ui/dialog`, exports `SignaturePadModal` as default, takes `{ open, onClose, onConfirm, title }` props, has `useEffect` initializing the canvas with `lineWidth=2 / lineCap=round / strokeStyle=#000`, and `pos / down / move / up / clear / confirm` handlers.

If the file does not match this shape, STOP and ask the controller — something has changed since this plan was written and the steps below may be stale.

- [ ] **Step 2: Replace the entire file with the upgraded component**

Overwrite `src/components/contracts/signature-pad-modal.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Caveat } from "next/font/google";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const caveat = Caveat({ subsets: ["latin"], display: "swap", weight: "400" });

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  title?: string;
}

type Tab = "draw" | "type";

export default function SignaturePadModal({ open, onClose, onConfirm, title = "Sign here" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [tab, setTab] = useState<Tab>("draw");
  const [typedName, setTypedName] = useState("");

  // Pre-warm the Caveat font face when the modal opens so the offscreen canvas
  // in Type mode has it cached by Insert-click time. No-op if already loaded.
  useEffect(() => {
    if (!open) return;
    if (typeof document !== "undefined" && document.fonts?.load) {
      document.fonts.load("60px Caveat").catch(() => {});
    }
  }, [open]);

  // Initialize the draw canvas each time the modal opens or the user switches
  // back to the Draw tab. Draws white background + sets stroke style.
  useEffect(() => {
    if (!open || tab !== "draw" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    setHasInk(false);
    lastPointRef.current = null;
  }, [open, tab]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * e.currentTarget.width,
      y: ((e.clientY - r.top) / r.height) * e.currentTarget.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    drawingRef.current = true;
    lastPointRef.current = { x, y };
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

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

  function up() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearDraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    lastPointRef.current = null;
  }

  // Render the typed name onto an offscreen canvas at the same dimensions as
  // the Draw canvas (600x200) so the downstream stamp coordinates are
  // identical regardless of which tab the user signed from.
  async function renderTypedToPng(): Promise<string> {
    if (typeof document !== "undefined" && document.fonts?.load) {
      try {
        await document.fonts.load("60px Caveat");
      } catch {
        // Fall through — system "cursive" fallback is acceptable.
      }
    }
    const off = document.createElement("canvas");
    off.width = 600;
    off.height = 200;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context for offscreen canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    let size = 60;
    ctx.font = `${size}px Caveat, cursive`;
    while (ctx.measureText(typedName).width > 560 && size > 28) {
      size -= 4;
      ctx.font = `${size}px Caveat, cursive`;
    }
    ctx.fillText(typedName, off.width / 2, off.height / 2);
    return off.toDataURL("image/png");
  }

  async function handleInsert() {
    if (tab === "draw") {
      if (!canvasRef.current) return;
      onConfirm(canvasRef.current.toDataURL("image/png"));
    } else {
      const dataUrl = await renderTypedToPng();
      onConfirm(dataUrl);
    }
    onClose();
  }

  const insertDisabled =
    tab === "draw" ? !hasInk : typedName.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(100vw-2rem,40rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div role="tablist" aria-label="Signature input mode" className="flex border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "draw"}
            aria-controls="signature-draw-panel"
            onClick={() => setTab("draw")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "draw"
                ? "border-[var(--brand-primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Draw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "type"}
            aria-controls="signature-type-panel"
            onClick={() => setTab("type")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "type"
                ? "border-[var(--brand-primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Type
          </button>
        </div>

        {/* Draw panel */}
        <div role="tabpanel" id="signature-draw-panel" hidden={tab !== "draw"}>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            className="w-full bg-white border border-border rounded touch-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={clearDraw}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Type panel */}
        <div role="tabpanel" id="signature-type-panel" hidden={tab !== "type"}>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full name"
            className="w-full px-3 py-2 text-sm border border-border rounded bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            autoFocus
          />
          <div
            className={`${caveat.className} mt-3 w-full h-[200px] bg-white border border-border rounded flex items-center justify-center text-5xl text-black overflow-hidden`}
            aria-hidden="true"
          >
            {typedName.trim() || (
              <span className="text-muted-foreground text-base font-sans">
                Live preview
              </span>
            )}
          </div>
        </div>

        {/* Disclaimer + action footer */}
        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground flex-1">
            I understand this is a legal representation of my signature.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded border border-border"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={insertDisabled}
              className="px-3 py-1.5 text-sm rounded bg-[var(--brand-primary)] text-white disabled:opacity-50"
            >
              Insert
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors. The file uses standard React 19 hooks + base-ui Dialog primitive already in use elsewhere. Caveat import mirrors the existing `Inter` import in `src/app/layout.tsx:2`.

If errors appear, fix them before moving on. The most likely classes of error:
- `next/font/google` not installed → it is, since `app/layout.tsx` already uses `Inter`. If somehow missing, `npm install next` would refresh it but that should not be necessary.
- `caveat.className` typed as `string` — should work directly inside template-literal `${caveat.className}`.
- React 19 type variance on `aria-selected` — if TypeScript complains about a boolean union, cast to `aria-selected={tab === "draw"}` evaluates to `boolean` which the React 19 typings accept; no cast needed.

- [ ] **Step 4: Production build check**

Run: `npm run build`

Expected: `✓ Compiled` with no errors. The build will fetch + self-host Caveat at build time (Next does this for `next/font/google` automatically), adding the font files into `.next/static/media/`.

If the build fails because of the new Caveat import (e.g. network blocked at build time), document the failure to the controller and stop. Caveat must be reachable from the build environment.

---

## Task 2: Manual smoke test in browser

**Files:** none (verification only)

The spec explicitly accepts manual smoke as the verification step (no automated tests). Do not skip — this is the test pass for this plan.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Wait for `Ready` message. Note the URL (default `http://localhost:3000`).

- [ ] **Step 2: Open a contract that has a signature field**

Navigate to a job with a contract draft, or use the existing AAA "Work Authorization (WTR)" template (template id `60862e63-...` per spec references). Send yourself a draft contract via the existing send flow, or open an in-person signing page directly.

Open the signing page in Chrome. Click the signature field to open `SignaturePadModal`.

- [ ] **Step 3: Smoke test 1 — Draw tab (thicker stroke + smoothing)**

Default tab should be "Draw." Draw a signature with the mouse. Verify:
- Stroke is visibly thicker than the previous build's 2 px line. Reference: side-by-side comparison with the prior thinner stroke (use git stash if needed to compare against the old version).
- Curves are smooth — no visible polyline kinks at direction changes.
- "Clear" button clears the canvas; redrawing works.
- "Insert" button is disabled until you draw at least one stroke.

- [ ] **Step 4: Smoke test 2 — Type tab (typed signature → PNG)**

Click the "Type" tab. Verify:
- Tab bar shows "Type" as the selected tab (different visual treatment from inactive "Draw").
- A text input appears with placeholder "Type your full name."
- A live preview area below the input shows "Live preview" placeholder text in muted color.
- Typing into the input updates the preview in real time, in cursive script (Caveat).
- "Insert" button is disabled until the input has non-whitespace text.

Type "Eric Daniels." Click Insert. The modal should close and the signature should appear on the contract preview where the signature field was. Submit the signed contract.

Open the resulting stamped PDF. Verify the cursive signature is rendered onto the signature field area on the appropriate page, in approximately the same region a drawn signature would have been stamped.

- [ ] **Step 5: Smoke test 3 — Long-name auto-shrink**

Click the signature field again to reopen the modal. Switch to Type. Type a long name like `Christopher Anderson-Whitfield-Jr`. Verify the cursive preview shrinks to fit the preview area without overflowing horizontally. Click Insert and confirm the offscreen-rendered PNG (which becomes the stamped signature) also fits within its 600 px region.

- [ ] **Step 6: Smoke test 4 — Tab-switch state preservation**

Open the modal. In the Type tab, type "Eric Daniels." Switch to Draw. Switch back to Type. Verify the input still contains "Eric Daniels" (the spec requires that switching tabs does not clear the other tab's state).

In the Draw tab, draw a stroke. Switch to Type, then back to Draw. The drawn stroke is allowed to be cleared on tab return — the `useEffect` reinitializes the canvas when the user switches back, which the spec accepts as a tradeoff because preserving canvas state across React renders inside a `hidden` tabpanel is fragile. Document any observed behavior here for the controller.

- [ ] **Step 7: Smoke test 5 — Disclaimer copy**

Verify the footer reads exactly:

```
I understand this is a legal representation of my signature.
```

No typos, no missing punctuation. Visible in both Draw and Type tabs.

- [ ] **Step 8: Smoke test 6 — Cancel + close**

Open modal, type something or draw, click Cancel. Modal closes, no signature applied to the contract. Reopen the modal — fresh state (Draw tab, empty canvas, Insert disabled).

- [ ] **Step 9: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

---

## Task 3: Commit + push

**Files:**
- `src/components/contracts/signature-pad-modal.tsx`

- [ ] **Step 1: Inspect the diff**

Run: `git diff src/components/contracts/signature-pad-modal.tsx`

Verify the diff matches what the plan intended:
- Adds `Caveat` import from `next/font/google`.
- Adds `Tab` type, `tab` and `typedName` state, `lastPointRef`.
- `useEffect` for font pre-warm.
- `useEffect` for canvas init now bumps `lineWidth` to `3.5` and adds `lineJoin = "round"`.
- `move` uses quadratic-curve smoothing.
- New `renderTypedToPng` async function.
- `handleInsert` (replaces `confirm`) branches on `tab`.
- Returns a tabbed dialog body with `role="tablist"` / `tab` / `tabpanel` markup.
- Disclaimer footer with the exact spec text.
- Confirm button renamed Insert.

- [ ] **Step 2: Stage and commit**

Run:

```bash
git add src/components/contracts/signature-pad-modal.tsx
git commit -m "$(cat <<'EOF'
feat(15f): signature pad thicker draw + Type mode w/ disclaimer

- Bump draw stroke 2 -> 3.5 + lineJoin round + quadratic-curve smoothing
- Add Type tab: text input + live Caveat-font preview + offscreen canvas
  render -> PNG via existing onConfirm contract (zero backend change)
- Auto-shrink typed font-size to fit 600px canvas (60->28 px floor)
- Pre-warm Caveat at modal open + await document.fonts.load before render
- Tab a11y wiring (role tablist/tab/tabpanel + aria-selected)
- Disclaimer footer "I understand this is a legal representation of my
  signature." shown in both tabs; Confirm button renamed Insert

Spec: docs/superpowers/specs/2026-05-07-signature-pad-type-mode-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

Run: `git push origin main`

Expected: push succeeds, Vercel auto-deploy triggers. Wait ~60-90 s for Vercel preview/prod build to complete; spot-check the live deploy at `aaaplatform.vercel.app` with one more end-to-end signing flow to confirm prod parity with the dev-server smoke.

- [ ] **Step 4: Vercel sanity**

Open `aaaplatform.vercel.app` (the production deploy). Open a draft contract, click the signature field, verify the modal renders with the new Tab bar and disclaimer footer. Optionally re-run the Type smoke against prod.

If the Vercel build fails (visible at the GitHub commit's status check or `vercel ls`), revert the commit on main and investigate locally before re-pushing.

---

## Self-Review

Spec coverage check (each spec section → task that implements it):

| Spec section | Implementing task |
|---|---|
| Goals: thicker stroke | Task 1 Step 2 (`lineWidth = 3.5`, `lineJoin = "round"`) |
| Goals: Type tab w/ script font | Task 1 Step 2 (Caveat import + Type panel + `renderTypedToPng`) |
| Goals: ESIGN disclaimer | Task 1 Step 2 (disclaimer footer block) |
| Goals: zero backend changes | Task 1 Step 2 (`onConfirm` contract preserved; Task 3 diff verifies no other files touched) |
| Architecture: single-file mod | Task 1 Step 2 (full rewrite of one file) |
| Architecture: font load race guard | Task 1 Step 2 (`await document.fonts.load("60px Caveat")` in `renderTypedToPng` + pre-warm in `useEffect`) |
| Architecture: auto-shrink for long names | Task 1 Step 2 (while loop on `measureText.width > 560`, floor at 28) |
| Architecture: quadratic smoothing | Task 1 Step 2 (`move` function rewrite) |
| Architecture: stroke config bumps | Task 1 Step 2 (`lineWidth`, `lineJoin` changes) |
| Architecture: disclaimer footer | Task 1 Step 2 (footer block) |
| Architecture: disabled-state rules | Task 1 Step 2 (`insertDisabled` const) |
| Architecture: tab a11y | Task 1 Step 2 (role/aria attributes on tablist + tabs + tabpanels) |
| Data flow: both paths produce PNG via `onConfirm` | Task 1 Step 2 (`handleInsert` branches but emits PNG either way) |
| Backward compat: no DB / RPC / API / stamp-pdf changes | Task 3 Step 1 (diff inspection confirms only one file changed) |
| Testing: manual smoke plan items 1-7 | Task 2 Steps 3-7 |

No spec sections without an implementing task.

Placeholder scan: no `TBD`, no `TODO`, no "implement later." All code blocks contain the actual code an engineer would type. The Caveat font name string is consistent across the import (`Caveat({ subsets: ["latin"], display: "swap", weight: "400" })`), the live preview's `caveat.className` usage, and the `ctx.font = "Npx Caveat, cursive"` calls — same family name in all three sites.

Type consistency: `tab` typed as `Tab = "draw" | "type"` and used identically across state, effect deps, panel `hidden` checks, and `insertDisabled` derivation. `lastPointRef` typed as `{ x: number; y: number } | null` and used consistently. `Props.onConfirm: (dataUrl: string) => void` matches every call site (`onConfirm(canvas.toDataURL(...))` and `onConfirm(await renderTypedToPng())`).

Plan is internally consistent and complete.
