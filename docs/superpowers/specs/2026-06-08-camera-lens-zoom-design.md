# Camera lens toggle — 0.5× / 1× / 2×

**Date:** 2026-06-08
**Status:** Approved design, pre-implementation
**Scope:** In-app native camera (`CameraView`) gets an iPhone-style lens toggle with three stops — 0.5× (ultra-wide), 1× (wide), 2× (digital crop on wide).

---

## 1. Goal

Add a segmented lens toggle to the in-app camera so a field user can shoot
ultra-wide (0.5×), normal (1×), or a 2× framing — the way the stock iOS Camera
behaves. Today the camera is fixed at the wide lens with no zoom control wired
(`enableZoom` is not passed to `CameraPreview.start`, so the plugin's pinch
gesture is inert).

**Non-goals (YAGNI):** no pinch-to-zoom changes, no optical telephoto, no
continuous zoom slider, no Android work, no front-camera zoom. Pinch stays
disabled in production (§5) — the pill is the sole zoom control.

---

## 2. The core abstraction: a factor → (lens, digital zoom) table

Everything keys off a single numeric **factor**. The factor is a UI label that
maps to a physical AVCaptureDevice plus a digital `videoZoomFactor`:

| Factor | Physical lens                 | `videoZoomFactor` | Notes |
|--------|-------------------------------|-------------------|-------|
| `0.5`  | `builtInUltraWideCamera`      | `1.0`             | True ultra-wide field of view. |
| `1`    | `builtInWideAngleCamera`      | `1.0`             | Current default. |
| `2`    | `builtInWideAngleCamera`      | `2.0`             | Digital crop of the wide lens — same approach non-Pro iPhones use for their 2× button. Slightly softer; no telephoto hardware needed. |

`0.5×` is a *label*, not a `videoZoomFactor` of 0.5. On the ultra-wide lens,
`videoZoomFactor = 1.0` already produces the 0.5×-equivalent field of view
relative to the wide lens. The plugin never sets a zoom factor below 1.0.

The wide lens's `activeFormat.videoMaxZoomFactor` is far above `2.0` on every
ultra-wide-capable iPhone (typically ≥16), so the `2.0` request is always
satisfiable; the clamp in §3 is purely defensive.

This table is the contract shared across the three layers below.

---

## 3. Layer A — Native plugin patch (Swift, via patch-package)

The `@capacitor-community/camera-preview` plugin is consumed by local path from
`node_modules` (`ios/App/CapApp-SPM/Package.swift` line 15), so patching its
Swift sources in `node_modules` and shipping the patch via **patch-package**
results in the patched code being compiled into the app. The CI clone script
(`ios/App/ci_scripts/ci_post_clone.sh`) runs `npm ci` (→ `postinstall` →
`patch-package`) before `npx cap sync ios`, so the patch is applied on every
build.

> **Note on what gets patched.** The plugin ships **pre-built**: the installed
> package contains both the iOS Swift sources (`ios/Sources/...`, compiled by
> SPM) and the compiled web bundle (`dist/esm/...`). There is no rebuild of the
> dependency during `npm ci`, so patch-package patches the shipped Swift and
> `dist` files **directly** and they are not regenerated. Only the generated
> `patches/*.patch` file is committed to the repo; the `node_modules` edits
> themselves are ephemeral (recreated by `postinstall`).

### A0. Set up patch-package (it is not yet installed) — **first task, blocks all others**

There is currently no `patches/` directory and no `postinstall` script. This
must land **before or with** the web UI (§9). Order matters — do these steps in
sequence or `postinstall` won't run on CI and the patch won't apply:

1. `npm install --save-dev patch-package postinstall-postinstall`
2. Add to `package.json` scripts: `"postinstall": "patch-package"`
3. Make the A1–A3 edits in `node_modules`.
4. `npx patch-package @capacitor-community/camera-preview` →
   `patches/@capacitor-community+camera-preview+8.0.1.patch`. Commit it.

### A1. `CameraController.swift`

**Device storage (line 23).** Replace the single `rearCamera` field with two
fixed physical handles plus an "active rear lens" pointer:

```swift
var rearWideCamera: AVCaptureDevice?       // builtInWideAngleCamera, back
var rearUltraWideCamera: AVCaptureDevice?  // builtInUltraWideCamera, back (nil on SE etc.)
var rearCamera: AVCaptureDevice?           // == the lens currently feeding the session
```

**Why `rearCamera` tracks the active lens:** `handleTap` (focus, line 436),
`handlePinch` (line 463), `getSupportedFlashModes` (line 288), and
`setFlashMode` (line 333) all read `self.rearCamera` when
`currentCameraPosition == .rear`. Keeping `rearCamera` pointed at whichever lens
is live means tap-to-focus and flash automatically target the active lens at
0.5× — **no edits to those four methods are needed**.

**Device discovery + assignment (lines 49, 54–66).** Widen the discovery types
and route by `deviceType` (without this, both back lenses match
`position == .back` and the last one wins — silently breaking the 1× default).
Reset zoom on the wide lens here so every fresh `start()` is deterministically
1× (see "restart" note in §5):

```swift
let session = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInWideAngleCamera, .builtInUltraWideCamera],
    mediaType: .video, position: .unspecified)

let cameras = session.devices.compactMap { $0 }
guard !cameras.isEmpty else { throw CameraControllerError.noCamerasAvailable }

for camera in cameras {
    if camera.position == .front {
        self.frontCamera = camera
    } else if camera.position == .back {
        if camera.deviceType == .builtInUltraWideCamera {
            self.rearUltraWideCamera = camera
        } else if camera.deviceType == .builtInWideAngleCamera {
            self.rearWideCamera = camera
        }
        try camera.lockForConfiguration()
        camera.focusMode = .continuousAutoFocus
        camera.videoZoomFactor = 1.0   // clear any zoom retained on the device singleton
        camera.unlockForConfiguration()
    }
}
self.rearCamera = self.rearWideCamera   // 1× / wide is always the start lens
self.zoomFactor = 1.0
```

> `videoZoomFactor` is a property of the **device** (a process-wide singleton),
> not the session — it persists when `prepare()` builds a fresh
> `AVCaptureSession`. Resetting it here is what makes "flip restarts → back to
> 1×" (§5) actually true.

**New method `setZoom(factor:)`.** Mirrors `switchCameras()` (lines 215–263) but
swaps the session input **only when the physical lens changes** (so 1×↔2× has no
flicker), and identifies lenses by **`uniqueID`** (object identity on
`AVCaptureDevice` is not guaranteed stable):

```swift
func setZoom(factor: CGFloat) throws {
    guard currentCameraPosition == .rear,
          let captureSession = self.captureSession, captureSession.isRunning,
          let currentInput = self.rearCameraInput,
          let activeRear = self.rearCamera else { throw CameraControllerError.invalidOperation }

    // factor → (target device, digital zoom)
    let targetDevice: AVCaptureDevice
    let targetZoom: CGFloat
    switch factor {
    case 0.5:
        guard let uw = rearUltraWideCamera else { throw CameraControllerError.invalidOperation }
        targetDevice = uw; targetZoom = 1.0
    case 2.0:
        guard let w = rearWideCamera else { throw CameraControllerError.invalidOperation }
        targetDevice = w; targetZoom = 2.0
    default: // 1.0
        guard let w = rearWideCamera else { throw CameraControllerError.invalidOperation }
        targetDevice = w; targetZoom = 1.0
    }

    let lensChanges = targetDevice.uniqueID != activeRear.uniqueID

    if lensChanges {
        captureSession.beginConfiguration()
        let newInput = try AVCaptureDeviceInput(device: targetDevice)
        // Remove-then-check matches switchCameras(): two simultaneous video
        // inputs are an invalid config, so canAddInput(newInput) returns false
        // while the old input is still attached. Roll back to the (known-valid)
        // old input on failure and commit a consistent session before throwing.
        captureSession.removeInput(currentInput)
        guard captureSession.canAddInput(newInput) else {
            if captureSession.canAddInput(currentInput) { captureSession.addInput(currentInput) }
            captureSession.commitConfiguration()
            throw CameraControllerError.invalidOperation
        }
        captureSession.addInput(newInput)
        self.rearCameraInput = newInput
        self.rearCamera = targetDevice
        // Set zoom inside the same transaction so the swapped-in lens never
        // shows a stale factor for a frame.
        try targetDevice.lockForConfiguration()
        targetDevice.videoZoomFactor = min(targetZoom, targetDevice.activeFormat.videoMaxZoomFactor)
        targetDevice.unlockForConfiguration()
        captureSession.commitConfiguration()
    } else {
        // Same lens (1×↔2×): just change the digital zoom, no reconfiguration.
        try targetDevice.lockForConfiguration()
        targetDevice.videoZoomFactor = min(targetZoom, targetDevice.activeFormat.videoMaxZoomFactor)
        targetDevice.unlockForConfiguration()
    }

    self.zoomFactor = min(targetZoom, targetDevice.activeFormat.videoMaxZoomFactor) // pinch baseline
}
```

**New method `availableZoomFactors() -> [CGFloat]`:** returns `[0.5, 1, 2]`
filtered so `0.5` is present only when `rearUltraWideCamera != nil`; always at
least `[1, 2]`. Availability is fixed at camera start (no hot-swap re-check —
acceptable; iPhone lenses don't change at runtime).

**Threading.** `setZoom` runs on the bridge thread like the existing `flip()`
(no `DispatchQueue.main` wrap), keeping the patch consistent with the plugin's
current style. Overlapping `setZoom` calls are prevented by the web-side
`isSwitchingLens` guard (§5). **Known residual race:** a tap-to-focus
(`handleTap`) landing in the exact window of a `beginConfiguration`/
`commitConfiguration` is not synchronized. The window is sub-frame and each
device lock is atomic, so the practical risk is low. A full serial
`captureSessionQueue` refactor would close it but enlarges the patch surface and
risks regressing the plugin's existing flip/focus/flash paths — see §10 for the
open decision.

### A2. `CameraPreviewPlugin.swift`

Register two bridge methods in the `pluginMethods` array (lines 15–26) and add
the methods, mirroring the `flip()` bridge pattern (lines 151–158):

```swift
CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
CAPPluginMethod(name: "getAvailableZoomFactors", returnType: CAPPluginReturnPromise),
```

```swift
@objc func setZoom(_ call: CAPPluginCall) {
    guard let factor = call.getDouble("factor") else {
        call.reject("factor is required"); return
    }
    do { try self.cameraController.setZoom(factor: CGFloat(factor)); call.resolve() }
    catch { call.reject("failed to set zoom") }
}

@objc func getAvailableZoomFactors(_ call: CAPPluginCall) {
    let factors = self.cameraController.availableZoomFactors().map { Double($0) }
    call.resolve(["factors": factors])
}
```

### A3. TypeScript definitions + web stub

- `dist/esm/definitions.d.ts`: add to the `CameraPreviewPlugin` interface:
  ```ts
  setZoom(options: { factor: number }): Promise<void>;
  getAvailableZoomFactors(): Promise<{ factors: number[] }>;
  ```
- `dist/esm/web.{js,d.ts}`: add stub methods on `CameraPreviewWeb` that call
  `this.unimplemented(...)` (matching the existing web stubs in that file — they
  use `this.unimplemented`, not bare `throw new Error`). This keeps the web class
  satisfying the interface and makes the web/desktop fallback reject cleanly.

Adding to the interface does not break the consuming app's typecheck even before
the web stub lands, because Next.js compiles with `skipLibCheck` (declaration
files in `node_modules` aren't cross-checked); the stub is added anyway for
runtime correctness and self-documentation.

---

## 4. Layer B — Web feature-detection (the version-skew guard)

The web layer deploys instantly via the Vercel live bundle
(`server.url = https://aaaplatform.vercel.app`), but native `setZoom` ships only
in a *new* iOS binary via TestFlight/App Store. The toggle must degrade
gracefully on an **old binary**.

**Where it lives:** the detection is owned by `useCameraLifecycle`, which already
owns `CameraPreview.start()`. After a successful `start()`, the hook calls
`getAvailableZoomFactors()` inside a try/catch and reports the result up via a
new optional callback:

```ts
// useCameraLifecycle input gains:
onZoomFactorsAvailable?: (factors: number[]) => void;
// after start() resolves:
try {
  const { factors } = await CameraPreview.getAvailableZoomFactors();
  onZoomFactorsAvailableRef.current?.(factors);
} catch {
  onZoomFactorsAvailableRef.current?.([]); // old binary / web → no toggle
}
```

`CameraView` stores the reported factors in state and derives pill visibility
from them. Detection outcomes:

- **New binary, ultra-wide present** → `[0.5, 1, 2]` → all three stops.
- **New binary, no ultra-wide** (iPhone SE) → `[1, 2]` → two stops.
- **Old binary** → Capacitor rejects `UNIMPLEMENTED` → caught → `[]` → no pill.
- **Web / desktop** → web stub `unimplemented` → caught → `[]` → no pill.

No crash, no coordination deadlock between the web deploy and the native ship.
Because the hook re-runs `start()` on every position/rect change, the factors are
re-detected after each restart — keeping the pill correct across flips.

---

## 5. Layer C — Web UI (`camera-view.tsx`)

A small segmented "pill" (`0.5×  1×  2×`, active stop highlighted) calling
`CameraPreview.setZoom({ factor })`.

**State (two values, to make error recovery unambiguous):**
- `selectedFactor` — what the pill highlights (optimistic; updates on tap).
- `confirmedFactor` — the last factor a `setZoom` actually resolved on.
- On tap: set `selectedFactor` immediately (responsive), call `setZoom`; on
  resolve set `confirmedFactor = selectedFactor`; on **reject** revert
  `selectedFactor = confirmedFactor`, log to console, no crash.

**Placement (matching the real DOM in `camera-view.tsx`):**
- **Stacked (portrait):** a flex row inside the controls panel (the `<div>` at
  ~line 463), **between the capture-count display and the `grid-cols-3` button
  row** — i.e. above the shutter, below the count.
- **Overlay (landscape):** in the right-rail cluster (`camera-right-rail`,
  ~line 516), grouped with the existing floating controls near the shutter.

**Styling:** match the tag-chip pattern already in the file (~lines 640–645):
`rounded-full border px-3 py-1 text-xs font-medium transition`, active stop
filled (white bg / dark text or the brand green), inactive stops translucent
with the `OVERLAY_ICON_SHADOW` drop-shadow in overlay mode for legibility.

**Visibility & concurrency:**
- Render only when `visibleZoomFactors(...).length > 1` (§7 helper).
- Hidden when `position === "front"`.
- A render-time guard (`if (position !== prevPosition) { … }`, React's "adjust
  state when a prop changes" pattern — **not** a `useEffect`) resets
  `selectedFactor` and `confirmedFactor` to `1` on **any** position change
  (covers both flip directions in one place). Render-time rather than an effect
  so it adds no `react-hooks/set-state-in-effect` lint violation to
  `camera-view.tsx`, which is currently clean of that rule.
- While a `setZoom` is in flight, an `isSwitchingLens` flag (plus the existing
  `busy` shutter flag) **disables** the pill (visible, reduced opacity); taps
  during this window are **dropped, not queued**, so two reconfigurations can
  never overlap.

**Flip → rear restart (why no explicit `setZoom(1)` is needed):** `handleFlip`
changes `position`; `useCameraLifecycle` detects the change and runs `stop()`
then `start()`. `start()` builds a fresh `AVCaptureSession` via `prepare()`,
which (per the A1 patch) re-selects the wide lens **and resets its
`videoZoomFactor` to 1.0**. So native deterministically returns to 1×, and the
`useEffect` above resets the UI to match — the two stay in sync without an extra
call.

---

## 6. Capability & error-handling matrix

| Situation | Behavior |
|-----------|----------|
| iPhone 11+ with ultra-wide | Pill shows `0.5× 1× 2×`. |
| iPhone SE (no ultra-wide) | Pill shows `1× 2×`. |
| Old native binary (pre-patch) | `getAvailableZoomFactors` rejects → no pill. |
| Web / desktop fallback | Web stub rejects → no pill. |
| `setZoom` rejects mid-session | `selectedFactor` reverts to `confirmedFactor`; console log; no crash. User can retry by tapping any stop. |
| Rapid taps during a switch | Dropped while `isSwitchingLens`; no overlapping reconfiguration. |
| Front camera active | Pill hidden; factor state forced to 1. |

---

## 7. Testing

**Pure logic (Vitest, unit).** Extract the web-side decision logic into
`src/lib/mobile/lens-zoom.ts` (colocated `*.test.ts` matches the repo
convention — e.g. `crypto-vault.test.ts`, `deep-link.test.ts` already live in
`src/lib/mobile/`). Concrete contract:

```ts
export type LensFactor = 0.5 | 1 | 2;

/** Stops the pill should show. [] (hide pill) on front camera or when ≤1 factor. */
export function visibleZoomFactors(
  available: number[],
  position: "rear" | "front",
): number[];

/** Next UI state after the user taps `factor`, given current confirmed state. */
export function selectFactor(
  state: { selectedFactor: number; confirmedFactor: number },
  factor: number,
): { selectedFactor: number; confirmedFactor: number };

/** Revert helper for a rejected setZoom. */
export function revertFactor(
  state: { selectedFactor: number; confirmedFactor: number },
): { selectedFactor: number; confirmedFactor: number };

/** Display label for a stop: 0.5 → "0.5×", 1 → "1×", 2 → "2×". */
export function formatFactorLabel(factor: number): string;
```

Test cases: `[]` available → hidden; `[1,2]` rear → `[1,2]`; `[0.5,1,2]` rear →
all three; any available + front → `[]`; select updates `selectedFactor` only;
revert restores `selectedFactor` to `confirmedFactor`.

If lifecycle integration grows beyond a callback, the detection may be factored
into a `useZoomFactors` hook with its own colocated test; the pure helpers above
stay framework-free regardless.

**Native AVFoundation.** Verified by **manual device testing** on a real
ultra-wide iPhone (11 or later): each stop renders the expected field of view;
capture at each stop yields a correct image; tap-to-focus and flash work at
0.5×; `setZoom` accepts the numeric factors; flip→front hides the pill and
flip→back returns to 1× (both UI and feed); rapid taps don't wedge the session.

**Suite hygiene.** `vitest run`, `tsc --noEmit`, and `npm run lint` are
known-red on clean `main`. Verify only that touched files add **no new**
failures — not the full tally.

---

## 8. File-change summary

Committed deliverables only; `node_modules` edits are intermediate (captured by
the `.patch` and regenerated by `postinstall`).

| File | Committed? | Change |
|------|-----------|--------|
| `package.json` | ✅ | Add `patch-package` + `postinstall-postinstall` devDeps; add `postinstall` script. |
| `patches/@capacitor-community+camera-preview+8.0.1.patch` | ✅ (new) | Captures all A1/A2/A3 `node_modules` edits. |
| `CameraController.swift` (in node_modules) | ⟶ via patch | Two lens handles; `rearCamera` tracks active lens; deviceType-routed discovery + zoom reset; `setZoom`, `availableZoomFactors`. |
| `CameraPreviewPlugin.swift` (in node_modules) | ⟶ via patch | Register + implement `setZoom`, `getAvailableZoomFactors`. |
| `dist/esm/definitions.d.ts` (in node_modules) | ⟶ via patch | Add two methods to the interface. |
| `dist/esm/web.{js,d.ts}` (in node_modules) | ⟶ via patch | `this.unimplemented` web stubs. |
| `src/lib/mobile/lens-zoom.ts` | ✅ (new) | Pure web decision logic. |
| `src/lib/mobile/lens-zoom.test.ts` | ✅ (new) | Unit tests. |
| `src/lib/mobile/use-camera-lifecycle.ts` | ✅ | Add `onZoomFactorsAvailable` callback; feature-detect after `start()`. |
| `src/components/mobile/camera-view.tsx` | ✅ | Hold factor state; render the lens pill; wire `setZoom`; visibility + concurrency rules. |

---

## 9. Sequencing

Native (TestFlight) and web (instant Vercel deploy) ship on different cadences.
Because the web layer feature-detects (§4), merge order is safe **provided
patch-package (§3 A0) lands before or with the web UI** — otherwise the first
native build after the web UI merges won't contain the patched methods and the
version-skew guard can't distinguish old from new binaries. With A0 in place:

- If the web UI lands first, the pill stays hidden on old binaries until the
  patched build ships.
- Once the patched binary is installed, the toggle appears with no further web
  deploy.

---

## 10. Open decision for review

**Serial session queue vs. minimal patch (threading).** The minimal design runs
`setZoom` on the bridge thread like the existing `flip()`, relying on the web
`isSwitchingLens` guard to serialize toggles, and accepts a narrow, low-risk
tap-to-focus-during-switch race (§3 A1, Threading). The alternative is to
introduce a dedicated serial `captureSessionQueue` and route `setZoom`, `flip`,
`handleTap`, `handlePinch`, and output-connection changes through it — fully
correct, but a larger patch that touches the plugin's existing, working paths
and carries regression risk. **Recommendation:** ship the minimal version;
revisit the queue only if device testing surfaces an actual focus/zoom race.
