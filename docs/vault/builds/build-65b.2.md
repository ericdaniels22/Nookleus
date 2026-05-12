---
build_id: 65b.2
title: Camera UI redesign (letterboxed brand-green chrome)
status: planned
phase: mobile
started: 2026-05-11
shipped: null
guide_doc: null
plan_file: docs/superpowers/plans/2026-05-11-build-65b.2-camera-ui-redesign.md
pr: null
handoff: null
related: ["[[build-65a]]", "[[build-65c]]"]
---

#status/planned #area/mobile #build/65b.2

## Scope

Visual + interaction redesign of the in-app camera (`src/components/mobile/camera-view.tsx`). Replaces the current full-bleed translucent chrome with a letterboxed layout featuring brand-green bezels, repositioned controls, a 3-mode flash, a status-aware queue button, and a confirmation step on accidental exits. No changes to the underlying sidecar / upload-queue / capture-storage pipeline shipped in 65c — this is pure UI.

Hybrid scope: visual language matches a reference design Vanessa supplied (letterbox + clean bezels + pill controls + bottom mode tabs *shape*); Nookleus-specific load-bearing features (X cancel, queue button, capture count, Tag/Rapid mode toggle) keep their function but get restyled.

Driven by Vanessa's request after the 65c smoke tests: "I want the UI to look more like \[the reference] rather than the current state." Decisions captured in a 20-question grilling session with Eric on 2026-05-11.

## Decisions locked (from 2026-05-11 grill)

### Layout

- **Orientation:** portrait only. `Info.plist` to be locked to `UIInterfaceOrientationPortrait` (currently allows landscape).
- **Viewport:** letterboxed, **4:3 aspect ratio**, rounded corners (~16pt).
- **Bezel color:** flat Nookleus brand green `#0F6E56` (= `--brand-primary`). Same shade as the active sidebar nav tab. Chosen over navy and over a green-accent-only compromise — Eric wants brand-forward.
- **Top strip:** ~90pt tall, extends to top edge of screen, iOS status bar overlays on green (one continuous strip).
- **Bottom strip:** ~150pt tall, taller than top (asymmetric — bottom has more controls).
- **Parent app chrome:** suppressed while camera is open. Fix in `app-shell.tsx`'s `INTERNAL_FULLSCREEN_PATTERNS`.

### Top strip layout

- **Top-left, alone:** X (close) button.
- **Top-right cluster** (left to right): Flip camera, Flash, Mode toggle, Settings gear.
- All four icons white on green.

### Bottom strip layout

- **Above the action row:** big count number, centered, white on green. Hidden when count = 0.
- **Action row** (left to right): Queue button, Shutter, Done pill.

### Controls behavior

- **X close:** confirms when count > 0 with "Leave camera? Your N photos will still upload." Yes/No. Silent exit at count = 0.
- **Flash:** 3 modes cycle — off → on → flashlight (`'torch'`) → off. Plugin already supports `'torch'`.
- **Mode toggle:** 2-state swap (Tag ↔ Rapid). **Default = Tag.** Icon swaps to show current state. Not future-proofed for 3+ modes (decided against — we'll redesign when needed).
- **Settings gear:** opens placeholder sheet ("Settings coming soon" or similar minimal copy).
- **Shutter:** solid white circle with thin dark outline, ~80pt diameter. Press behavior: `active:scale-95` only. **No full-screen flash** (Vanessa shoots 100-shot bursts; full-screen flash 100× = migraine).
- **Done:** pill labeled "Done" (text only, no count, no icon). Always visible regardless of count.
- **Queue button:** stack/list icon + status dot. No dot = idle, amber = uploads in flight, **red pulsing** = at least one failure.

### Empty state (count = 0)

- Count number hidden.
- Done + Queue buttons visible.
- Queue dot may still show if prior-session uploads are in flight.

### Tag-after flow

- **Out of scope for this build.** Defer full redesign to its own future grill.
- Apply minimal visual restyle during implementation (swap black background to brand green palette, restyle tag pills) so it doesn't look jarring against the new chrome.

### Out-of-scope

- Zoom selector (reference has one; the camera plugin doesn't expose zoom reliably; would need plugin work).
- Library button (no clear destination — Nookleus doesn't have an in-app photo roll).
- Bottom mode tabs (SCAN/WALKTHRU/VIDEO/DUAL VIDEO) — none of those features exist.
- Haptic feedback on upload failure (Eric skipped during grill).
- Banner/toast on failure (Eric chose pulsing dot only).

## Implementation notes

- **Header bleed-through fix:** `src/components/app-shell.tsx:15-17` — add `/^\/jobs\/[^/]+\/capture(\/|$)/` to `INTERNAL_FULLSCREEN_PATTERNS`. The camera view at `fixed inset-0 z-[1000]` should already cover the sidebar, but the sidebar's mobile top-bar appears to bleed through; cleanest fix is to skip rendering the shell entirely on the capture route.
- **Flash plugin support:** `@capacitor-community/camera-preview` already supports `flashMode: 'off' | 'on' | 'auto' | 'red-eye' | 'torch'`. We use `off → on → torch → off`.
- **4:3 viewport:** `CameraPreview.start({ width, height, ... })` accepts pixel dimensions. For 4:3 portrait on `window.innerWidth = 393`, set `height = Math.round(393 * 4 / 3) = 524`. The plugin renders behind the WebView at exactly those dimensions; we position a transparent placeholder div over that rectangle.
- **Queue status dot:** reuse `useUploadQueue()` from `src/lib/mobile/upload-queue-context.tsx`. Pattern is already in `upload-queue-badge.tsx` (failures = red, uploading = blue/pulsing).
- **Default capture mode:** check `src/lib/mobile/use-capture-mode.ts` for current default; flip to `'tag-after'` if it's not already.

## Future builds filed during grill

- **LiDAR mode** (Scan/Measure) using ARKit + RoomPlan — native Swift Capacitor plugin work. **Sizing:** 1-2 weeks for point-to-point distance measurement; 3-4 weeks for full room scanning. LiDAR-only iPhone Pro models (12 Pro+). Adds a 3rd mode to the toggle (Tag/Rapid/LiDAR) when ready.
- **Tag-after flow redesign** — bottom-sheet vs full-screen preview, tag picker UX, caption affordance, gesture handling. Separate grilling session.
- **Additional capture modes** (Video, Scan, Walkthrough) — only when underlying features exist. Don't ship empty buttons.
- **Zoom selector (.5x / 1x / 3x buttons)** — surfaced again 2026-05-11 during 65b.2 execute session; deferred. `@capacitor-community/camera-preview` v8.0.1 exposes no JS zoom method and opens only `.builtInWideAngleCamera` (so .5x ultra-wide and 3x telephoto lenses are unreachable). Path: patch-package the plugin to (a) add `setZoom(factor)` JS method, (b) prefer `.builtInTripleCamera` / `.builtInDualWideCamera` when available so a single `videoZoomFactor` switches lenses. Sizing: ~1-2 hr. Caveats: requires Xcode rebuild loop (breaks the Vercel-preview iteration mode used in 65b.2); lens availability varies per iPhone model (non-Pro = no telephoto; pre-iPhone-11 = no ultra-wide) so the UI needs device-aware button states; SPM `Package.swift` is cap-sync-managed (see memory `project_capacitor_plugins_npm_declaration`).

## Source

- Spec: embedded in this card (no separate file)
- Plan: [docs/superpowers/plans/2026-05-11-build-65b.2-camera-ui-redesign.md](../../../docs/superpowers/plans/2026-05-11-build-65b.2-camera-ui-redesign.md)
- Predecessors: [[build-65c]] (just shipped — upload pipeline, the foundation this UI sits on)
- Grilling session: 2026-05-11 (this conversation)
