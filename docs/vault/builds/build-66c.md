---
build_id: 66c
title: Vault skills (handoff, orient, templates)
status: planned
phase: knowledge-vault
started: null
shipped: null
guide_doc: null
handoff: null
related: ["[[build-66a]]", "[[build-66b]]", "[[build-66d]]"]
---

> **Retired 2026-06-05.** The knowledge-vault continuity loop these builds created (the `00-NOW.md` log, dated handoffs, and the `/handoff` + `/orient` skills) was retired — see [ADR 0010](../../adr/0010-retire-knowledge-vault-continuity-loop.md). This card is preserved as historical record.

#status/planned #area/knowledge-vault #area/tooling #build/66c

## What's planned

Authoring the Claude Code skills that keep the vault current without willpower:

- `end-of-session-handoff` (also `/handoff`) — writes a dated handoff and updates `00-NOW.md` at session end.
- `start-of-session-orientation` (also `/orient`) — reads the vault and gives a one-paragraph briefing at session start.
- Templater stub bodies in `_templates/` filled in with the canonical structures these skills produce.

## Source

- Predecessors: [[build-66a]], [[build-66b]]
- Guide: none
