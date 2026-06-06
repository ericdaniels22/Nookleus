---
date: 2026-04-21
title: Rename product to Nookleus
status: locked
related_builds: ["[[build-65a]]"]
---

#decision #area/branding

# Rename product to Nookleus

**Decision:** the product name is **Nookleus**. The repo slug stays `aaa-platform` and the web app continues to render "AAA Disaster Recovery" as its public-facing brand until a separate-domain decision is made.

**Locked:** 2026-04-21.

## What changes

- iOS app display name: `Nookleus` (Info.plist, capacitor.config `appName`).
- Internal/team references in vault, plans, handoffs: Nookleus.
- App icons, splash screens, App Store metadata: Nookleus (rolls out via [[build-65a]] family).

## What does NOT change

- GitHub repo: `github.com/ericdaniels22/aaa-platform`.
- Production Supabase project ID: `rzzprgidqbnqcdupmpfe`.
- Web public-facing brand: "AAA Disaster Recovery" — the first tenant in the multi-tenant org table is AAA, and the web app continues to surface that brand name on customer-facing pages until a separate domain (likely `nookleus.app`) is stood up post-65e.
- Capacitor `appId`: `com.aaacontracting.platform` — permanent per the plan §8 locked decision; phase-5 white-label rebuilds swap this via per-target Capacitor configs, not by editing.

## Implementation trail

- **2026-04-26** — Build 65a Windows session sets `appName: 'AAA Disaster Recovery'` initially in `capacitor.config.ts` (live bundle landed first; rename was a follow-on).
- **2026-04-28** — Mac/iPhone smoke ships [[build-65a]] under tag `mobile-v0.1.0` with the AAA name. Rename gated on this proving the live-bundle approach works.
- **2026-04-28** — Display name updated to Nookleus via PR #28 (commit `1d48859 build65a-followup: rename ios app display name to Nookleus`).
- **Later** — PR #38 (commit `57c1c67 65a: rename app to Nookleus (Info.plist, capacitor.config, build 2)`) updates `Info.plist` + `capacitor.config.ts` `appName` and bumps build number to 2.

## Related

- [[build-65a]]
- [[00-glossary]] entry for **Nookleus**.
