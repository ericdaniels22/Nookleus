---
build_id: 66b
title: Knowledge vault backfill (audit-first)
status: in-progress
phase: knowledge-vault
started: 2026-04-29
shipped: null
guide_doc: null
plan_file: docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md
handoff: null
related: ["[[build-66a]]", "[[build-66c]]", "[[build-66d]]"]
---

> **Retired 2026-06-05.** The knowledge-vault continuity loop these builds created (the `00-NOW.md` log, dated handoffs, and the `/handoff` + `/orient` skills) was retired — see [ADR 0010](../../adr/0010-retire-knowledge-vault-continuity-loop.md). This card is preserved as historical record.

#status/in-progress #area/knowledge-vault #area/tooling #build/66b

## What's shipping

Audit-first backfill of the vault content from repo evidence (migrations, routes, code, commits, plan files, handoff documents) — no card written from training, memory, or guide-doc summary alone. Produces:

- One build card per shipped build under `builds/`.
- Per-session handoff entries under `handoffs/` (preserving session-a / session-b / session-c distinctions for builds 18a/b/c).
- Data-source cards for the heavy-hitter Supabase tables.
- The Jarvis agent card under `agents/jarvis.md` with platform-skill spinoffs under `platform-skills/`.
- Decisions backfill (Nookleus rename, build52 NULL-tokens lesson, others as evidence surfaces).
- Refreshed `00-NOW.md` with the corrected major-systems inventory and the "Last verified against repo" date bumped.

The non-negotiable discipline: every claim is repo-grounded. The four guide docx files (v1.3/1.4/1.6/1.7) cover specs through Build 17 only — anything later is read off the codebase.

## Source

- Plan: [docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md](../../../docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md) §66b
- Predecessor: [[build-66a]]
- Guide: none (this build is itself the audit-first backfill)
