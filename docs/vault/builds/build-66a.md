---
build_id: 66a
title: Knowledge vault scaffolding
status: shipped
phase: knowledge-vault
started: 2026-04-29
shipped: 2026-04-29
guide_doc: null
plan_file: docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md
handoff: null
related: ["[[build-66b]]", "[[build-66c]]", "[[build-66d]]"]
---

> **Retired 2026-06-05.** The knowledge-vault continuity loop these builds created (the `00-NOW.md` log, dated handoffs, and the `/handoff` + `/orient` skills) was retired — see [ADR 0010](../../adr/0010-retire-knowledge-vault-continuity-loop.md). This card is preserved as historical record.

#status/shipped #area/knowledge-vault #area/tooling #build/66a

## What shipped

The empty-but-structured `docs/vault/` tree: subfolders for builds, handoffs, decisions, agents, platform-skills, data-sources, plus the always-paste pair (`00-NOW.md`, `00-glossary.md`) and Templater stubs.

- **Layout** (this folder): `agents/`, `builds/`, `data-sources/`, `decisions/`, `handoffs/`, `platform-skills/`, `_templates/`, plus `00-NOW.md`, `00-glossary.md`, `README.md`.
- **Template stubs** in `_templates/` are intentional placeholders; full template bodies land in [[build-66c]] when the `end-of-session-handoff` skill defines the canonical structure.
- **No migration** — docs-only.

## Source

- Commit: `298a072 tooling: vault scaffolding (build 66a)`
- Plan: [docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md](../../../docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md)
- Guide: none
