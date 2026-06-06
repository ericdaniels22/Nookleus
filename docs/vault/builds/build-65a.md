---
build_id: 65a
title: Capacitor iOS scaffold (Nookleus)
status: shipped
phase: mobile
started: 2026-04-26
shipped: 2026-04-28
guide_doc: null
handoff: null
related: ["[[2026-04-21-rename-to-nookleus]]"]
---

#status/shipped #area/mobile #build/65a

## What shipped

The native iOS shell around the existing Next.js app — Capacitor 8.3.1, live-bundle WebView load against `https://aaaplatform.vercel.app`, signed via Eric's free-tier Apple ID, runs on his iPhone. **Zero `src/` changes.** Foundation work for the Build 65 mobile series.

The follow-on Nookleus rename ([[2026-04-21-rename-to-nookleus]]) updated `Info.plist`, `capacitor.config.ts` `appName`, and the iOS bundle display name (PR #38, commit `57c1c67`).

- **Capacitor:** `@capacitor/core ^8.3.1`, `@capacitor/ios ^8.3.1`, `@capacitor/cli ^8.3.1`. Capacitor 8 uses **Swift Package Manager** (no CocoaPods, no Podfile).
- **Configuration:** [capacitor.config.ts](../../../capacitor.config.ts) — `appId: 'com.aaacontracting.platform'`, `appName: 'Nookleus'`, `webDir: 'out'`, `server.url: 'https://aaaplatform.vercel.app'`, `server.errorPath: 'index.html'`.
- **Offline fallback:** `out/index.html` stub committed; WebView falls back when Vercel is unreachable on cold launch.
- **Real-iPhone smoke test (2026-04-28):** all 12 plan §10 checklist items green — login, navigation, workspace switch, deep links, brand assets, no console errors.
- **No migration** — native shell only.

## Planned follow-ups (Build 65 series)

- **Build 65b** — custom camera UI (queued).
- **Build 65c** — upload pipeline (queued).
- **Build 65d** — mobile responsiveness audit (queued).
- **Build 65e** — App Store submission + flip from live-bundle to bundled-static per plan §5.5 (queued; Apple Developer Program enrollment in progress).

## Source

- Commits: `a2ae498 build65a: Capacitor iOS scaffolding (#25)` → `1d48859 rename ios app display name to Nookleus (#28)` → `57c1c67 65a: rename app to Nookleus (Info.plist, capacitor.config, build 2) (#38)`
- Tag: `mobile-v0.1.0`
- Guide: none
