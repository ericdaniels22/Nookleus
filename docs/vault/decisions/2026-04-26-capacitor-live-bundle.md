---
date: 2026-04-26
title: Capacitor 65a/b/c uses live-bundle WebView (flip to bundled-static at 65e)
status: locked
related_builds: ["[[build-65a]]"]
---

#decision #area/mobile

# Capacitor live-bundle for 65a/b/c, bundled-static at 65e

**Decision:** ship the iOS shell pointing at `https://aaaplatform.vercel.app` via Capacitor's `server.url`. Defer the architectural flip to a bundled-static `webDir` until [[build-65a|Build 65e]] (App Store submission).

**Locked:** 2026-04-26 (plan §5.1, written into `2026-04-26-build-65-mobile-platform.md`).

## Why live-bundle for now

- **Speed of iteration.** The web app is the primary surface and ships continuously to Vercel. With live-bundle, every `git push` reaches mobile users without an Xcode rebuild + TestFlight reissue.
- **Identical behavior.** The WebView renders the same code as desktop browsers. No mobile-only fork. No risk of feature drift between platforms during early iteration.
- **65b/c are still UI work.** The custom camera UI ([[build-65a|65b]]) and upload pipeline ([[build-65a|65c]]) are easier to iterate against the live web bundle than against bundled-static rebuilds.

## Why bundled-static at 65e

Capacitor's docs annotate `server.url` as **"not intended for use in production."** For App Store submission specifically:

- Apple's review process expects a self-contained bundle.
- Offline behavior with `server.url` is brittle (only the `errorPath` stub at `out/index.html` falls back; navigation breaks if Vercel is unreachable mid-session).
- App Store reviewers can't inspect a remote server's behavior; they review what's in the binary.

So at 65e the architectural flip happens: `webDir: 'out'` becomes the live bundle (Next.js static export, which the project already supports — `out/` is generated from `next build` and is committed as the offline-fallback stub today).

## What lives under this decision

- [capacitor.config.ts](../../../capacitor.config.ts) — `server.url: 'https://aaaplatform.vercel.app'`, `server.errorPath: 'index.html'`, `cleartext: false`.
- The committed `out/index.html` offline-fallback stub.
- The 65a smoke-test green is the *correctness validation* of the scaffold itself; the live-bundle approach **inherits** all production behavior of the existing web app, so the 65a Rule C zero-findings is also validation of the fence.

## How to apply

- **Don't** prematurely flip to bundled-static during 65b/c. The pre-65e architectural-decision check at the start of 65e is the right place.
- **Don't** add mobile-only behavior to the WebView. If you need it, do it in `src/` so it ships through Vercel, not as native Capacitor code that has to wait for an Xcode rebuild.
- **Do** write the 65e plan with the `webDir` flip + offline behavior + push-notification permissions as the four-corners scope.

## Related

- Build: [[build-65a]]
