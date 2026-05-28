---
build_id: 65b.3
title: iPad camera landscape overlay redesign
status: in-progress
phase: mobile
started: 2026-05-28
shipped: null
guide_doc: null
plan_file: null
pr: null
handoff: null
related: ["[[build-65b.2]]", "[[build-65c]]"]
---

#status/in-progress #area/mobile #build/65b.3

## Scope

Landscape-only repaint of the camera (`src/components/mobile/camera-view.tsx`). Replaces the existing "split" layout (4:3 preview on the left + flat black controls panel on the right) with an **overlay** layout: a 4:3 preview centered horizontally, sized to viewport height, with controls floating directly on the preview pixels.

Portrait (iPhone + iPad portrait) is untouched — the Build 65b.2 letterboxed brand-green chrome stays. No changes to the native plugin contract, the capture/upload pipeline, or `useCameraLifecycle`.

Driven by the parent PRD #344 (issue #345 ships the entire PRD as a single slice). Decisions locked in a `/grill-with-docs` session on 2026-05-28.

## Decisions locked (from 2026-05-28 grill)

### Layout

- **Mode enum:** `compute-camera-layout` exports `"stacked" | "overlay"` (was `"stacked" | "split"`). Naming change reflects the paradigm shift — controls now float on top of the preview, not in a sibling panel.
- **Landscape rule (single):** `width = round(viewportHeight * 4 / 3)`; `height = viewportHeight`; `x = round((viewportWidth - width) / 2)`; `y = 0`. No `controlsMinSize` consultation in the landscape branch. `controlsMinSize` becomes optional on the input type so portrait callsites stay unchanged.
- **Defensive narrow-landscape fallback removed.** iPad Split View slots are portrait-shaped in practice and never hit the previous fallback. Square/exotic Stage Manager sizes degrade gracefully (preview clips against viewport edges).
- **Worked examples:**
  - 1024×768 (4:3 iPad landscape): preview is edge-to-edge, `{ x: 0, y: 0, width: 1024, height: 768 }`.
  - 1180×820 (modern non-4:3 iPad landscape): preview centered with ~44pt black margins on either side, `{ x: 44, y: 0, width: 1093, height: 820 }`.
  - 800×800 (square / `>=` rule): `mode === "overlay"`.

### Top-right cluster (overlay only)

- Absolutely positioned, anchored to `env(safe-area-inset-top)` + `env(safe-area-inset-right)`.
- Four icons in DOM order: **mode toggle (Tag↔Rapid) → flip → flash → settings**.
- Bare white icons (no chip backgrounds), with a 1–2px CSS `drop-shadow` filter for legibility against bright preview content.
- **No X cancel.** Done is the sole exit affordance in landscape.

### Right rail (overlay only)

- Absolutely positioned at the right edge, vertically centered with a `translateY(-50%)` transform. Respects `env(safe-area-inset-right)`.
- Top-to-bottom: **Done pill → capture count → shutter → queue button**.
- Capture count hidden when `count === 0`; rendered as bold white tabular-nums with a text-shadow when `count > 0`.
- Done pill: brand-green gradient (current `doneButton` styling preserved verbatim).
- Shutter: solid white, brand-green inner ring, ~80pt (current `shutterButton` styling preserved verbatim).
- Queue button: brand-green gradient circle with the existing status-dot rules (red pulsing on failure, amber on uploading/pending, none on idle).

### Sheets (overlay only)

- Settings sheet and tag-after sheet keep their right-edge slide-in pattern, with **~40% viewport width** (`w-[40vw]`) instead of the previous `w-80 max-w-[60%]`.
- `data-mode="overlay"` on the sheet root for testability.
- Opaque dark backdrop sits behind the sheet column only (the sheet itself is the column); preview remains visible on the left ~60%.

### Leave-confirm

- Mounted only when `layout.mode === "stacked"`. In overlay mode there is no X cancel, so the leave-confirm cannot be opened. Captures persist on write, so the warning is redundant in landscape.

### Visual treatment (first cut)

- Top-cluster icon shadow filter: `drop-shadow(0 1px 2px rgb(0 0 0 / 0.6)) drop-shadow(0 0 1px rgb(0 0 0 / 0.4))`.
- Capture-count text shadow: `0 1px 2px rgb(0 0 0 / 0.7)`.
- **No right-edge scrim.** If real-device verification on the Mac/Xcode loop shows icon-legibility problems against bright preview content, file a follow-up issue for a soft right-edge scrim — do not bake it into this slice.

## Implementation notes

- `src/lib/mobile/compute-camera-layout.ts`: enum renamed; landscape branch collapsed to a four-line rule; `controlsMinSize` made optional with default `0`.
- `src/components/mobile/camera-view.tsx`: split `topRow` into `stackedTopRow` (still includes X cancel) and `overlayTopCluster` (four floating icons). Overlay branch uses absolute positioning rather than the previous `flex flex-row` sibling-panel layout. Leave-confirm rendered only when `stacked`.
- `useCameraLifecycle`: untouched. The rect it receives in landscape is now `viewportHeight * 4/3 × viewportHeight` centered, but the hook is rect-agnostic.
- `Info.plist`: untouched.

## Tests

- `src/lib/mobile/compute-camera-layout.test.ts`: rewritten landscape cases (1024×768 edge-to-edge, 1180×820 centered with margins, 800×800 square → overlay). Previous "landscape narrow → stacked" assertion removed. Portrait cases unchanged.
- `src/components/mobile/camera-view.test.tsx`: new overlay-branch group covers top-cluster DOM order, right-rail DOM order with/without count, sheet `data-mode="overlay"` + right-edge geometry, leave-confirm absent in overlay. Stacked-mode visual regression tests retained verbatim.

## Real-device verification

Pending on the Mac/Xcode loop against a physical iPad:

- [ ] Preview fills as expected on whichever iPad model is available.
- [ ] Right-rail icons remain legible against varied scene brightness.
- [ ] Home indicator does not collide with the right-rail bottom edge.
- [ ] Rotating portrait↔landscape mid-session preserves the session count and does not freeze the preview.
- [ ] If icon-legibility fails, file a follow-up issue for a soft right-edge scrim (do not add one in this slice).

## Out of scope

Deferred from 65b.2 and still deferred here:

- Zoom selector (.5x / 1x / 3x) — requires patching `@capacitor-community/camera-preview`; breaks the Vercel-preview iteration mode.
- Photo library button — Nookleus has no in-app photo roll.
- SCAN / WALKTHROUGH / PHOTO mode wheel — none of those modes exist; do not ship empty buttons.
- Tag-after flow redesign (caption affordance, tag picker layout, gesture handling) — separate future build.
- Haptics on capture / upload failure.
- iPhone landscape — `Info.plist` keeps iPhone portrait-locked.

Not warranted by this build:

- `CONTEXT.md` updates — "overlay" / "stacked" / "right rail" are implementation shorthand, not durable domain terms.
- ADR — design is scoped and reversible (CSS + layout math); rationale lives in this card.

## Source

- PRD: GitHub issue [#344](https://github.com/ericdaniels22/Nookleus/issues/344)
- Implementation issue: GitHub issue [#345](https://github.com/ericdaniels22/Nookleus/issues/345)
- Predecessor: [[build-65b.2]] — letterboxed brand-green portrait chrome (the sibling design this overlay slots next to)
- Grilling session: 2026-05-28 `/grill-with-docs` (decisions captured in #344)
