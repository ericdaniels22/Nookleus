# Camera Lens Toggle (0.5× / 1× / 2×) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an iPhone-style segmented lens toggle (0.5× ultra-wide / 1× wide / 2× digital crop) to the in-app native camera, degrading gracefully on devices/binaries that lack the native support.

**Architecture:** Three layers behind one shared `factor → (lens, videoZoomFactor)` contract. **Layer A** patches the `@capacitor-community/camera-preview` Swift + TS sources in `node_modules` via **patch-package** (the plugin is consumed by local path, so patched sources are compiled into the app). **Layer B** adds runtime feature-detection in `useCameraLifecycle` so an old native binary or the web fallback simply hides the toggle. **Layer C** renders the pill in `camera-view.tsx`, calling `CameraPreview.setZoom({ factor })` with optimistic-then-revert state. Pure decision logic is extracted to `src/lib/mobile/lens-zoom.ts` and unit-tested.

**Tech Stack:** Next.js 16.2.2, React 19.2.4, Capacitor 8.x, `@capacitor-community/camera-preview@8.0.1`, AVFoundation (Swift), patch-package, Vitest + @testing-library/react.

**Source of truth:** `docs/superpowers/specs/2026-06-08-camera-lens-zoom-design.md`. Threading: minimal (JS-side `isSwitchingLens` serialization), per spec §10, approved.

---

## File Structure

| File | New? | Responsibility |
|------|------|----------------|
| `src/lib/mobile/lens-zoom.ts` | new | Framework-free decision logic: which stops to show, optimistic select / revert transitions, label formatting. The single source of UI truth, fully unit-testable. |
| `src/lib/mobile/lens-zoom.test.ts` | new | Vitest unit tests for the above. |
| `package.json` | modify | Add `patch-package` + `postinstall-postinstall` devDeps and a `postinstall` script. |
| `patches/@capacitor-community+camera-preview+8.0.1.patch` | new | Captures all `node_modules` Swift + TS edits (Layer A). The only committed artifact of the native change; the `node_modules` edits themselves are ephemeral. |
| `src/lib/mobile/use-camera-lifecycle.ts` | modify | Owns `CameraPreview.start()`; gains an `onZoomFactorsAvailable` callback that feature-detects via `getAvailableZoomFactors()` after each start. |
| `src/lib/mobile/use-camera-lifecycle.test.ts` | modify | Add the `getAvailableZoomFactors` mock + tests for the resolve/reject paths. |
| `src/components/mobile/camera-view.tsx` | modify | Holds factor state; renders the lens pill in both stacked and overlay layouts; wires `setZoom` with visibility + concurrency rules. |

**Dependency / ordering notes:**
- Task 1 (pure logic) is standalone and TDD-able first.
- Task 2 (patch-package tooling) must land **before or with** the web UI (spec §9) so the version-skew guard can distinguish old from new binaries on CI builds.
- Task 3 (native patch) edits `node_modules` directly. Tasks 4 and 5 call `CameraPreview.getAvailableZoomFactors()` / `setZoom()`, whose **types live in the patched `dist/esm/definitions.d.ts`**. `skipLibCheck` (confirmed in `tsconfig.json`) does NOT excuse *calling* a method absent from the interface — so Task 3 must precede Tasks 4 and 5 for the app to typecheck locally.
- Native AVFoundation behavior cannot be unit-tested on this platform; Task 6 is a manual on-device verification checklist (spec §7).

**Suite hygiene (spec §7):** `vitest run`, `tsc --noEmit`, and `npm run lint` are known-red on clean `main`. Verify only that touched files add **no new** failures — not the full tally.

---

## Task 1: Pure lens-zoom decision logic

**Files:**
- Create: `src/lib/mobile/lens-zoom.ts`
- Test: `src/lib/mobile/lens-zoom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mobile/lens-zoom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  visibleZoomFactors,
  selectFactor,
  revertFactor,
  formatFactorLabel,
} from "./lens-zoom";

describe("visibleZoomFactors", () => {
  it("hides the pill (returns []) when no factors are available", () => {
    expect(visibleZoomFactors([], "rear")).toEqual([]);
  });

  it("hides the pill when only one factor is available", () => {
    expect(visibleZoomFactors([1], "rear")).toEqual([]);
  });

  it("returns [1, 2] on a device without ultra-wide (rear)", () => {
    expect(visibleZoomFactors([1, 2], "rear")).toEqual([1, 2]);
  });

  it("returns all three stops on an ultra-wide device (rear)", () => {
    expect(visibleZoomFactors([0.5, 1, 2], "rear")).toEqual([0.5, 1, 2]);
  });

  it("hides the pill on the front camera regardless of availability", () => {
    expect(visibleZoomFactors([0.5, 1, 2], "front")).toEqual([]);
  });
});

describe("selectFactor", () => {
  it("updates only selectedFactor, leaving confirmedFactor unchanged", () => {
    expect(selectFactor({ selectedFactor: 1, confirmedFactor: 1 }, 2)).toEqual({
      selectedFactor: 2,
      confirmedFactor: 1,
    });
  });
});

describe("revertFactor", () => {
  it("restores selectedFactor to confirmedFactor", () => {
    expect(revertFactor({ selectedFactor: 0.5, confirmedFactor: 1 })).toEqual({
      selectedFactor: 1,
      confirmedFactor: 1,
    });
  });
});

describe("formatFactorLabel", () => {
  it("renders the factor with a multiplication sign", () => {
    expect(formatFactorLabel(0.5)).toBe("0.5×");
    expect(formatFactorLabel(1)).toBe("1×");
    expect(formatFactorLabel(2)).toBe("2×");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/mobile/lens-zoom.test.ts`
Expected: FAIL — `Failed to resolve import "./lens-zoom"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/mobile/lens-zoom.ts`:

```ts
/**
 * Pure decision logic for the camera lens toggle (0.5× / 1× / 2×).
 *
 * Framework-free so it can be unit-tested without React or Capacitor. The
 * component (`camera-view.tsx`) and the lifecycle hook own the side effects;
 * this module owns the rules. See
 * docs/superpowers/specs/2026-06-08-camera-lens-zoom-design.md §7.
 */

export type LensFactor = 0.5 | 1 | 2;

/**
 * The stops the pill should display. Returns [] (hide the pill entirely) on
 * the front camera or when one or fewer factors are available. Otherwise the
 * available factors are returned as-is (the native layer owns availability).
 */
export function visibleZoomFactors(
  available: number[],
  position: "rear" | "front",
): number[] {
  if (position === "front") return [];
  if (available.length <= 1) return [];
  return available;
}

/**
 * Next UI state after the user taps `factor`. Optimistic: selectedFactor moves
 * immediately; confirmedFactor only changes once a setZoom actually resolves.
 */
export function selectFactor(
  state: { selectedFactor: number; confirmedFactor: number },
  factor: number,
): { selectedFactor: number; confirmedFactor: number } {
  return { selectedFactor: factor, confirmedFactor: state.confirmedFactor };
}

/** Revert helper for a rejected setZoom: snap selectedFactor back to confirmed. */
export function revertFactor(state: {
  selectedFactor: number;
  confirmedFactor: number;
}): { selectedFactor: number; confirmedFactor: number } {
  return {
    selectedFactor: state.confirmedFactor,
    confirmedFactor: state.confirmedFactor,
  };
}

/** "0.5×", "1×", "2×" — the label shown on each pill segment. */
export function formatFactorLabel(factor: number): string {
  return `${factor}×`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/mobile/lens-zoom.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck the touched files**

Run: `npx tsc --noEmit`
Expected: No **new** errors referencing `lens-zoom.ts` or `lens-zoom.test.ts` (pre-existing repo errors are known-red; ignore those).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobile/lens-zoom.ts src/lib/mobile/lens-zoom.test.ts
git commit -m "feat(camera): pure lens-zoom decision logic + tests"
```

---

## Task 2: Install patch-package tooling

**Files:**
- Modify: `package.json` (add devDeps + `postinstall` script)
- Modify: `package-lock.json` (regenerated by npm)

- [ ] **Step 1: Install the dev dependencies**

Run: `npm install --save-dev patch-package postinstall-postinstall`
Expected: `package.json` `devDependencies` now lists `patch-package` and `postinstall-postinstall`; `package-lock.json` updated. No `postinstall` runs yet (the script does not exist), so no patches are applied.

- [ ] **Step 2: Add the postinstall script**

Edit `package.json` — in the `"scripts"` block, add the `postinstall` entry. Change:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:pg": "vitest run --config vitest.pg.config.ts"
  },
```

to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:pg": "vitest run --config vitest.pg.config.ts",
    "postinstall": "patch-package"
  },
```

- [ ] **Step 3: Verify postinstall is a clean no-op with no patches present**

Run: `npm run postinstall`
Expected: patch-package prints something like `No patch files found` and exits 0. (There is no `patches/` directory yet — that is created in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(camera): add patch-package tooling + postinstall hook"
```

---

## Task 3: Native plugin patch (Swift + TS via patch-package)

**Files (edited in `node_modules`, captured by the generated patch — NOT committed individually):**
- `node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraController.swift`
- `node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraPreviewPlugin.swift`
- `node_modules/@capacitor-community/camera-preview/dist/esm/definitions.d.ts`
- `node_modules/@capacitor-community/camera-preview/dist/esm/web.d.ts`
- `node_modules/@capacitor-community/camera-preview/dist/esm/web.js`

**Committed deliverable:**
- Create: `patches/@capacitor-community+camera-preview+8.0.1.patch`

> **Why no per-file commits:** `node_modules` is gitignored. `npx patch-package <pkg>` captures the entire diff of the package into a single `.patch` file; that file is the deliverable. Make ALL the edits below first, then generate the patch once.

> **Before editing — verify the anchors.** patch-package relies on exact text; a dependency bump since this plan was written could shift the source so an `Edit` fails (or a hand-edit silently no-ops and yields an empty/partial patch). Re-read the source and confirm before you start:
> - `CameraController.swift` declares exactly `var rearCamera: AVCaptureDevice?` and `var rearCameraInput: AVCaptureDeviceInput?` (no `rearWideCamera`/`rearUltraWideCamera` yet).
> - The `DiscoverySession(...)` line lists exactly `[.builtInWideAngleCamera]`.
> - `CameraPreviewPlugin.swift`'s `pluginMethods` array ends with `CAPPluginMethod(name: "isCameraStarted", returnType: CAPPluginReturnPromise)` and **no** trailing comma.
> - `dist/esm/{definitions.d.ts,web.d.ts,web.js}` each close their `isCameraStarted` member exactly as quoted in Steps 6–8.
>
> If any anchor differs, adjust that step's `old_string` to match the real source — never force the quoted text.

- [ ] **Step 1: `CameraController.swift` — replace single rear handle with two lens handles + active pointer**

In `node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraController.swift`, change:

```swift
    var rearCamera: AVCaptureDevice?
    var rearCameraInput: AVCaptureDeviceInput?
```

to:

```swift
    var rearWideCamera: AVCaptureDevice?       // builtInWideAngleCamera, back
    var rearUltraWideCamera: AVCaptureDevice?  // builtInUltraWideCamera, back (nil on SE etc.)
    var rearCamera: AVCaptureDevice?           // == the lens currently feeding the session
    var rearCameraInput: AVCaptureDeviceInput?
```

- [ ] **Step 2: `CameraController.swift` — widen discovery, route by deviceType, reset zoom**

In the same file, inside `configureCaptureDevices()`, change:

```swift
            let session = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera], mediaType: AVMediaType.video, position: .unspecified)

            let cameras = session.devices.compactMap { $0 }
            guard !cameras.isEmpty else { throw CameraControllerError.noCamerasAvailable }

            for camera in cameras {
                if camera.position == .front {
                    self.frontCamera = camera
                }

                if camera.position == .back {
                    self.rearCamera = camera

                    try camera.lockForConfiguration()
                    camera.focusMode = .continuousAutoFocus
                    camera.unlockForConfiguration()
                }
            }
```

to:

```swift
            let session = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .builtInUltraWideCamera], mediaType: AVMediaType.video, position: .unspecified)

            let cameras = session.devices.compactMap { $0 }
            guard !cameras.isEmpty else { throw CameraControllerError.noCamerasAvailable }

            for camera in cameras {
                if camera.position == .front {
                    self.frontCamera = camera
                }

                // Two separate `if`s (NOT `else if`): each device is its own loop
                // iteration and a device's position is front XOR back, so this is
                // behaviorally identical to a chained `else if` — but leaving the
                // front block untouched yields a smaller, lower-risk patch diff, and
                // every rear lens (wide AND ultra-wide) independently enters this
                // block to get its retained zoom reset to 1.0.
                if camera.position == .back {
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

- [ ] **Step 3: `CameraController.swift` — add `setZoom` + `availableZoomFactors` after `switchCameras()`**

In the same file, find the end of `switchCameras()`:

```swift
        switch currentCameraPosition {
        case .front:
            try switchToRearCamera()

        case .rear:
            try switchToFrontCamera()
        }

        captureSession.commitConfiguration()
    }
```

and replace it with that same block followed by the two new methods:

```swift
        switch currentCameraPosition {
        case .front:
            try switchToRearCamera()

        case .rear:
            try switchToFrontCamera()
        }

        captureSession.commitConfiguration()
    }

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
            // Build the new input BEFORE beginConfiguration(): AVCaptureDeviceInput(device:)
            // can throw, and throwing after beginConfiguration() would leave the session
            // in an open, uncommitted configuration that breaks later camera operations.
            let newInput = try AVCaptureDeviceInput(device: targetDevice)
            captureSession.beginConfiguration()
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

    func availableZoomFactors() -> [CGFloat] {
        var factors: [CGFloat] = []
        if rearUltraWideCamera != nil { factors.append(0.5) }
        factors.append(1.0)
        factors.append(2.0)
        return factors
    }
```

- [ ] **Step 4: `CameraPreviewPlugin.swift` — register the two bridge methods**

In `node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraPreviewPlugin.swift`, change:

```swift
        CAPPluginMethod(name: "isCameraStarted", returnType: CAPPluginReturnPromise)
    ]
```

to:

```swift
        CAPPluginMethod(name: "isCameraStarted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAvailableZoomFactors", returnType: CAPPluginReturnPromise)
    ]
```

- [ ] **Step 5: `CameraPreviewPlugin.swift` — implement the two bridge methods after `flip(_:)`**

In the same file, find `flip(_:)`:

```swift
    @objc func flip(_ call: CAPPluginCall) {
        do {
            try self.cameraController.switchCameras()
            call.resolve()
        } catch {
            call.reject("failed to flip camera")
        }
    }
```

and replace it with that same block followed by the two new methods:

```swift
    @objc func flip(_ call: CAPPluginCall) {
        do {
            try self.cameraController.switchCameras()
            call.resolve()
        } catch {
            call.reject("failed to flip camera")
        }
    }

    @objc func setZoom(_ call: CAPPluginCall) {
        guard let factor = call.getDouble("factor") else {
            call.reject("factor is required")
            return
        }
        do {
            try self.cameraController.setZoom(factor: CGFloat(factor))
            call.resolve()
        } catch {
            call.reject("failed to set zoom")
        }
    }

    @objc func getAvailableZoomFactors(_ call: CAPPluginCall) {
        let factors = self.cameraController.availableZoomFactors().map { Double($0) }
        call.resolve(["factors": factors])
    }
```

- [ ] **Step 6: `dist/esm/definitions.d.ts` — extend the `CameraPreviewPlugin` interface**

In `node_modules/@capacitor-community/camera-preview/dist/esm/definitions.d.ts`, change:

```ts
    isCameraStarted(): Promise<{
        value: boolean;
    }>;
}
```

to:

```ts
    isCameraStarted(): Promise<{
        value: boolean;
    }>;
    setZoom(options: { factor: number; }): Promise<void>;
    getAvailableZoomFactors(): Promise<{ factors: number[]; }>;
}
```

- [ ] **Step 7: `dist/esm/web.d.ts` — extend the `CameraPreviewWeb` declaration**

In `node_modules/@capacitor-community/camera-preview/dist/esm/web.d.ts`, change:

```ts
    isCameraStarted(): Promise<{
        value: boolean;
    }>;
}
```

to:

```ts
    isCameraStarted(): Promise<{
        value: boolean;
    }>;
    setZoom(_options: { factor: number; }): Promise<void>;
    getAvailableZoomFactors(): Promise<{ factors: number[]; }>;
}
```

- [ ] **Step 8: `dist/esm/web.js` — add the web stub implementations**

In `node_modules/@capacitor-community/camera-preview/dist/esm/web.js`, change:

```js
    async isCameraStarted() {
        throw this.unimplemented('Not implemented on web.');
    }
}
```

to:

```js
    async isCameraStarted() {
        throw this.unimplemented('Not implemented on web.');
    }
    async setZoom(_options) {
        throw this.unimplemented('Not implemented on web.');
    }
    async getAvailableZoomFactors() {
        throw this.unimplemented('Not implemented on web.');
    }
}
```

- [ ] **Step 9: Generate the patch**

Run this from the **repository root** (the directory containing `package.json`). patch-package writes file paths relative to the current working directory and CI runs from the root, so generating it from a subdirectory (e.g. `ios/App`) produces a patch with wrong paths that won't apply in CI.

Run: `npx patch-package @capacitor-community/camera-preview`
Expected: creates `patches/@capacitor-community+camera-preview+8.0.1.patch` **at the repo root** and prints a success line. (patch-package excludes only the dependency's own `package.json` by default; all `.swift`, `.d.ts`, and `.js` edits above are captured.)

- [ ] **Step 10: Verify the patch captured all five required files**

Run:
```bash
grep -E "^diff --git" patches/@capacitor-community+camera-preview+8.0.1.patch
```
Expected: a `diff --git` line **present for each** of the five edited files — `CameraController.swift`, `CameraPreviewPlugin.swift`, `definitions.d.ts`, `web.d.ts`, and `web.js`. Confirm each by name rather than asserting an exact total count: a clean hand-edit touches only these five, but a presence check stays correct if anything extra is ever captured. If any of the five is missing, re-check that file's edit and re-run Step 9.

- [ ] **Step 11: Sanity-check that the patch applies (non-destructive)**

Run: `npm run postinstall`

patch-package now runs against the **already-patched** working tree, so it detects the edits are present. Depending on the patch-package version this prints either a success line or a benign "already applied"/skip notice — **both are acceptable**. The only output that signals a real problem is `**ERROR** Failed to apply patch for package @capacitor-community/camera-preview`, which means the patch's context no longer matches the package; if you see that, regenerate via Step 9.

> **Authoritative validation is CI's clean install** — not this command. patch-package is designed to apply during `npm ci` on a fresh `node_modules`, which is exactly what `ios/App/ci_scripts/ci_post_clone.sh` does (`npm ci` → `postinstall` → `npx cap sync ios`). Do **not** `rm -rf node_modules && npm ci` (or PowerShell `Remove-Item -Recurse`) in this working tree to test it: that is slow and, in this repo, can wipe a junctioned/worktree `node_modules` shared with other sessions. Trust Step 10 plus this non-destructive check locally; let CI (or a throwaway worktree install) be the clean-tree proof.

- [ ] **Step 12: Commit**

```bash
git add patches/@capacitor-community+camera-preview+8.0.1.patch
git commit -m "feat(camera): native setZoom + getAvailableZoomFactors patch (0.5x/1x/2x)"
```

> Native AVFoundation behavior is verified on a real device in Task 6 — there is no local Swift compile/test on this platform.

---

## Task 4: Web feature-detection in `useCameraLifecycle`

**Files:**
- Modify: `src/lib/mobile/use-camera-lifecycle.ts`
- Modify: `src/lib/mobile/use-camera-lifecycle.test.ts`

> **PREREQUISITE — Task 3 must be fully committed first (through Step 12).** This task calls `CameraPreview.getAvailableZoomFactors()`, whose type lives in the patched `dist/esm/definitions.d.ts`. `skipLibCheck` does NOT excuse calling a method the interface doesn't declare, so until the patch is generated **and installed** (the edits live in `node_modules`), Step 5's `tsc --noEmit` will report a real new error here. If you are running tasks out of order, stop and finish Task 3 first.

- [ ] **Step 1: Write the failing tests + extend the mock**

In `src/lib/mobile/use-camera-lifecycle.test.ts`, change the mock block (top of file):

```ts
const startMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const stopMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());

vi.mock("@capacitor-community/camera-preview", () => ({
  CameraPreview: {
    start: (arg: unknown) => startMock(arg),
    stop: () => stopMock(),
  },
}));
```

to:

```ts
const startMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const stopMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const getFactorsMock = vi.fn(
  (): Promise<{ factors: number[] }> => Promise.resolve({ factors: [0.5, 1, 2] }),
);

vi.mock("@capacitor-community/camera-preview", () => ({
  CameraPreview: {
    start: (arg: unknown) => startMock(arg),
    stop: () => stopMock(),
    getAvailableZoomFactors: () => getFactorsMock(),
  },
}));
```

> `getFactorsMock` is a **module-level `const`** (declared outside the `vi.mock` factory), mirroring the existing `startMock`/`stopMock` already in this file. That pattern is proven to work in this repo: vitest hoists the `vi.mock` call, but the factory closure only runs lazily when the mocked module is first imported — by then the `const` initializers have executed, so the reference resolves. Its default impl is set at declaration and re-established in `beforeEach` (below) so each test starts from `{ factors: [0.5, 1, 2] }`; individual tests override it with `mockImplementationOnce`.

Then add `getFactorsMock.mockClear();` and reset its default implementation inside `beforeEach`:

```ts
  beforeEach(() => {
    startMock.mockClear();
    stopMock.mockClear();
    getFactorsMock.mockClear();
    getFactorsMock.mockImplementation(() => Promise.resolve({ factors: [0.5, 1, 2] }));
  });
```

Then add these two test cases at the end of the `describe("useCameraLifecycle", ...)` block (before its closing `});`):

```ts
  it("reports available zoom factors after start resolves", async () => {
    const rect = { x: 0, y: 0, width: 390, height: 520 };
    const onZoomFactorsAvailable = vi.fn();
    renderHook(() =>
      useCameraLifecycle({
        rect,
        position: "rear",
        safeAreaTop: 0,
        onZoomFactorsAvailable,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onZoomFactorsAvailable).toHaveBeenCalledWith([0.5, 1, 2]);
  });

  it("reports [] when getAvailableZoomFactors rejects (old binary / web)", async () => {
    getFactorsMock.mockImplementationOnce(() => Promise.reject(new Error("UNIMPLEMENTED")));
    const rect = { x: 0, y: 0, width: 390, height: 520 };
    const onZoomFactorsAvailable = vi.fn();
    renderHook(() =>
      useCameraLifecycle({
        rect,
        position: "rear",
        safeAreaTop: 0,
        onZoomFactorsAvailable,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onZoomFactorsAvailable).toHaveBeenCalledWith([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mobile/use-camera-lifecycle.test.ts`
Expected: the two new tests FAIL (`onZoomFactorsAvailable` never called — the hook doesn't call `getAvailableZoomFactors` yet). The pre-existing tests should still pass.

- [ ] **Step 3: Implement the feature-detection in the hook**

In `src/lib/mobile/use-camera-lifecycle.ts`, change the input interface:

```ts
export interface UseCameraLifecycleInput {
  rect: CameraLifecycleRect;
  position: "rear" | "front";
  safeAreaTop: number;
  onError?: (err: unknown) => void;
}
```

to:

```ts
export interface UseCameraLifecycleInput {
  rect: CameraLifecycleRect;
  position: "rear" | "front";
  safeAreaTop: number;
  onError?: (err: unknown) => void;
  /** Reports the rear-camera zoom stops detected after each successful start.
   *  Receives [] when the native method is unavailable (old binary / web). */
  onZoomFactorsAvailable?: (factors: number[]) => void;
}
```

Change the destructure + refs:

```ts
  const { rect, position, safeAreaTop, onError } = input;
  const startedRef = useRef(false);
  const lastRectRef = useRef<CameraLifecycleRect | null>(null);
  const lastPositionRef = useRef<"rear" | "front">(position);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
```

to:

```ts
  const { rect, position, safeAreaTop, onError, onZoomFactorsAvailable } = input;
  const startedRef = useRef(false);
  const lastRectRef = useRef<CameraLifecycleRect | null>(null);
  const lastPositionRef = useRef<"rear" | "front">(position);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onZoomFactorsAvailableRef = useRef(onZoomFactorsAvailable);
  onZoomFactorsAvailableRef.current = onZoomFactorsAvailable;
```

Change the `start` function body:

```ts
      try {
        await CameraPreview.start({
          position: pos,
          parent: "camera-preview-mount",
          toBack: true,
          width: r.width,
          height: Math.round(r.height + safeTop),
          x: r.x,
          y: r.y,
          disableAudio: true,
        });
        startedRef.current = true;
      } catch (err) {
        onErrorRef.current?.(err);
      }
```

to:

```ts
      try {
        await CameraPreview.start({
          position: pos,
          parent: "camera-preview-mount",
          toBack: true,
          width: r.width,
          height: Math.round(r.height + safeTop),
          x: r.x,
          y: r.y,
          disableAudio: true,
        });
        startedRef.current = true;
        // Feature-detect zoom support after a successful start. An old native
        // binary (pre-patch) or the web fallback rejects here → report [] so
        // the UI hides the lens pill. Re-runs on every restart (flip/resize).
        try {
          const { factors } = await CameraPreview.getAvailableZoomFactors();
          onZoomFactorsAvailableRef.current?.(factors);
        } catch {
          onZoomFactorsAvailableRef.current?.([]);
        }
      } catch (err) {
        onErrorRef.current?.(err);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mobile/use-camera-lifecycle.test.ts`
Expected: PASS — all tests, old and new, green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No **new** errors in `use-camera-lifecycle.ts`. (`CameraPreview.getAvailableZoomFactors` resolves against the patched `definitions.d.ts` from Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobile/use-camera-lifecycle.ts src/lib/mobile/use-camera-lifecycle.test.ts
git commit -m "feat(camera): feature-detect zoom factors in useCameraLifecycle"
```

---

## Task 5: Lens pill UI in `camera-view.tsx`

**Files:**
- Modify: `src/components/mobile/camera-view.tsx`

> Depends on Task 1 (`lens-zoom.ts` helpers), Task 3 (`setZoom` type), and Task 4 (`onZoomFactorsAvailable` callback).

- [ ] **Step 1: Confirm the React import — no change needed**

This task resets the factor state on flip with React's render-time "adjust state when a prop changes" pattern (Step 4), **not** a `useEffect`. Leave the existing import as-is — do NOT add `useEffect`:

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
```

> A reset `useEffect(..., [position])` would add a new `react-hooks/set-state-in-effect` violation to `camera-view.tsx`, which is currently clean of that rule (the repo-wide known-red instances live in other files). The render-time guard in Step 4 achieves the identical reset with no lint violation — it is the pattern React documents under "You Might Not Need an Effect → Adjusting some state when a prop changes."

- [ ] **Step 2: Import the lens-zoom helpers**

After the existing `import { useCameraLifecycle } from "@/lib/mobile/use-camera-lifecycle";` line, add:

```tsx
import {
  visibleZoomFactors,
  selectFactor,
  revertFactor,
  formatFactorLabel,
} from "@/lib/mobile/lens-zoom";
```

- [ ] **Step 3: Add lens state**

Find:

```tsx
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
```

and replace with:

```tsx
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [availableFactors, setAvailableFactors] = useState<number[]>([]);
  const [selectedFactor, setSelectedFactor] = useState<number>(1);
  const [confirmedFactor, setConfirmedFactor] = useState<number>(1);
  const [isSwitchingLens, setIsSwitchingLens] = useState(false);
  // `position` is declared above (line 88), so reading it here is safe. Drives
  // the render-time reset in Step 4 (React "adjust state when a prop changes").
  const [prevPosition, setPrevPosition] = useState(position);
```

- [ ] **Step 4: Wire the feature-detection callback + render-time reset-on-flip**

Find the `useCameraLifecycle({ ... })` call:

```tsx
  useCameraLifecycle({
    rect: layout.previewRect,
    position,
    safeAreaTop: safeAreaTopRef.current,
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      setPermissionError(message);
    },
  });
```

and replace with:

```tsx
  useCameraLifecycle({
    rect: layout.previewRect,
    position,
    safeAreaTop: safeAreaTopRef.current,
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      setPermissionError(message);
    },
    // Wrap the setter instead of passing it directly. The direct pass also
    // typechecks (a setter accepting `number[] | updater` is assignable to a
    // `(factors: number[]) => void` callback by parameter contravariance), but
    // the explicit adapter documents the contract and avoids reviewer churn.
    onZoomFactorsAvailable: (factors) => setAvailableFactors(factors),
  });

  // Reset the toggle to 1× whenever `position` changes. The native session
  // rebuild on flip (useCameraLifecycle stop()+start()) re-selects the wide
  // lens at videoZoomFactor 1.0, so the UI must snap to 1× to stay in sync with
  // the feed. This is React's render-time "adjust state when a prop changes"
  // pattern — NOT a useEffect (see Step 1) — so it adds no
  // `react-hooks/set-state-in-effect` violation. It runs at most once per flip:
  // setPrevPosition makes the guard false on the immediate re-render.
  if (position !== prevPosition) {
    setPrevPosition(position);
    setSelectedFactor(1);
    setConfirmedFactor(1);
  }
```

- [ ] **Step 5: Add the `handleSetZoom` callback**

Find the end of `handleFlip`:

```tsx
  const handleFlip = useCallback(async () => {
    if (busy) return;
    const next = position === "rear" ? "front" : "rear";
    setPosition(next);
    try {
      await CameraPreview.flip();
    } catch {
      // Some plugin builds need restart-on-flip; the lifecycle hook will
      // restart automatically because `position` changed.
    }
  }, [busy, position]);
```

and replace with that same block followed by `handleSetZoom`:

```tsx
  const handleFlip = useCallback(async () => {
    if (busy) return;
    const next = position === "rear" ? "front" : "rear";
    setPosition(next);
    try {
      await CameraPreview.flip();
    } catch {
      // Some plugin builds need restart-on-flip; the lifecycle hook will
      // restart automatically because `position` changed.
    }
  }, [busy, position]);

  const handleSetZoom = useCallback(
    async (factor: number) => {
      // Drop taps while a switch is in flight or the shutter is busy — two
      // reconfigurations must never overlap (spec §5).
      if (isSwitchingLens || busy) return;
      const optimistic = selectFactor({ selectedFactor, confirmedFactor }, factor);
      if (optimistic.selectedFactor === selectedFactor) return; // tap on active stop
      setSelectedFactor(optimistic.selectedFactor);
      setIsSwitchingLens(true);
      try {
        await CameraPreview.setZoom({ factor });
        setConfirmedFactor(factor);
      } catch {
        // Native rejected (e.g. lens missing) — revert the optimistic highlight.
        const reverted = revertFactor({
          selectedFactor: optimistic.selectedFactor,
          confirmedFactor,
        });
        setSelectedFactor(reverted.selectedFactor);
      } finally {
        setIsSwitchingLens(false);
      }
    },
    [busy, confirmedFactor, isSwitchingLens, selectedFactor],
  );
```

- [ ] **Step 6: Build the pill element**

Find:

```tsx
  const stacked = layout.mode === "stacked";
```

and replace with:

```tsx
  const stacked = layout.mode === "stacked";

  // Segmented lens toggle. Rendered only when more than one stop is available
  // and on the rear camera (visibleZoomFactors enforces both). Disabled (but
  // visible, dimmed) while a switch is in flight; taps are dropped, not queued.
  const visibleFactors = visibleZoomFactors(availableFactors, position);
  const lensPill =
    visibleFactors.length > 1 ? (
      <div
        data-testid="camera-lens-pill"
        className={cn(
          "flex items-center gap-1 rounded-full border border-white/25 bg-black/40 p-1",
          (isSwitchingLens || busy) && "opacity-50",
        )}
      >
        {visibleFactors.map((factor) => {
          const active = factor === selectedFactor;
          return (
            <button
              key={factor}
              type="button"
              disabled={isSwitchingLens || busy}
              onClick={() => handleSetZoom(factor)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                active ? "bg-white text-black" : "bg-transparent text-white",
              )}
              aria-pressed={active}
              aria-label={`Zoom ${formatFactorLabel(factor)}`}
            >
              {formatFactorLabel(factor)}
            </button>
          );
        })}
      </div>
    ) : null;
```

- [ ] **Step 7: Place the pill in the stacked (portrait) layout**

Find (inside the stacked controls panel):

```tsx
            <div>
              {count > 0 && (
                <div className="mb-2 text-lg font-semibold text-white tabular-nums">
                  {count}
                </div>
              )}
              <div className="grid w-full grid-cols-3 items-center">
```

and replace with:

```tsx
            <div>
              {count > 0 && (
                <div className="mb-2 text-lg font-semibold text-white tabular-nums">
                  {count}
                </div>
              )}
              {lensPill && (
                <div className="mb-3 flex justify-center">{lensPill}</div>
              )}
              <div className="grid w-full grid-cols-3 items-center">
```

- [ ] **Step 8: Place the pill in the overlay (landscape) right-rail**

Find (inside `camera-right-rail`):

```tsx
            {shutterButton}
            {queueButton}
          </div>
        </>
      )}
```

and replace with:

```tsx
            {lensPill && (
              <div style={{ filter: OVERLAY_ICON_SHADOW }}>{lensPill}</div>
            )}
            {shutterButton}
            {queueButton}
          </div>
        </>
      )}
```

- [ ] **Step 9: Typecheck and lint the touched file**

Run: `npx tsc --noEmit`
Expected: No **new** errors in `camera-view.tsx`.

Run: `npx eslint src/components/mobile/camera-view.tsx src/lib/mobile/use-camera-lifecycle.ts src/lib/mobile/lens-zoom.ts`
Expected: **Zero** lint errors in these files. In particular `camera-view.tsx` must stay free of `react-hooks/set-state-in-effect`: the flip reset uses the render-time guard from Step 4, not an effect, so it introduces no new violation. If eslint flags that rule here, you accidentally wrote the reset as a `useEffect` — convert it to the render-time `if (position !== prevPosition)` guard.

- [ ] **Step 10: Run the full mobile unit suite for regressions**

Run: `npx vitest run src/lib/mobile/`
Expected: `lens-zoom.test.ts` and `use-camera-lifecycle.test.ts` pass; no NEW failures vs. clean `main` (some mobile tests are known-flaky/red — compare against the baseline, don't require a green tally).

- [ ] **Step 11: Commit**

```bash
git add src/components/mobile/camera-view.tsx
git commit -m "feat(camera): lens toggle pill (0.5x/1x/2x) in CameraView"
```

---

## Task 6: Manual on-device verification (no automated coverage possible)

**Files:** none — this is a verification gate, run on a real ultra-wide iPhone (11 or later) after the patched binary ships to TestFlight (spec §7).

Native AVFoundation behavior cannot be exercised on this dev platform. After a TestFlight build that includes the patch (Task 3) and the web bundle (Tasks 1, 4, 5) is live, verify on device:

- [ ] **Step 1:** Open the in-app camera on an ultra-wide iPhone → the pill shows `0.5×  1×  2×`, with `1×` highlighted.
- [ ] **Step 2:** Tap `0.5×` → field of view widens to ultra-wide; tap `2×` → tighter 2× framing; tap `1×` → returns to normal. Each transition is prompt with no crash.
- [ ] **Step 3:** Capture a photo at each stop → the saved image matches the previewed framing.
- [ ] **Step 4:** Tap-to-focus and cycle flash while on `0.5×` → both target the active (ultra-wide) lens correctly.
- [ ] **Step 5:** Flip to front → the pill disappears. Flip back to rear → the pill reappears with `1×` highlighted and the feed at 1× (no retained zoom).
- [ ] **Step 6:** Rapidly tap between stops → no session wedge; the pill dims during each switch and settles on the last committed stop.
- [ ] **Step 7:** On an iPhone SE (no ultra-wide), confirm the pill shows only `1×  2×`.
- [ ] **Step 8:** On an **old** binary (pre-patch) still pointed at the live web bundle, confirm no pill appears and the camera otherwise works (version-skew guard).

---

## Sequencing & merge order (spec §9)

Native (TestFlight) and web (instant Vercel deploy) ship on different cadences. Because Layer B feature-detects, merge order is safe **provided Task 2 (patch-package tooling) lands before or with the web UI** — otherwise the first native build after the web UI merges won't contain the patched methods and the version-skew guard can't distinguish old from new binaries. With the tasks in the order above (1 → 2 → 3 → 4 → 5), this holds:

- If the web UI lands first, the pill stays hidden on old binaries until the patched build ships.
- Once the patched binary is installed, the toggle appears with no further web deploy.
