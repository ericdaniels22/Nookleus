# Nookleus knowledge vault

This folder is the curated knowledge content for the Nookleus platform (formerly `aaa-platform`). It is opened in Obsidian as part of a vault that has the **repo root** itself as its root, so `.claude/skills/`, `src/`, and the rest of the repo are visible alongside this folder. Curated knowledge — what's shipped, what's queued, what was decided and why — lives here.

## Frozen reference archive

This vault is a **frozen reference archive**. The continuity loop it once drove (`00-NOW.md` + dated handoffs + the `/handoff` / `/orient` skills) was retired on 2026-06-05 — see [ADR 0010](../adr/0010-retire-knowledge-vault-continuity-loop.md). Current platform state, work plans, and feature builds now live in **GitHub issues** (github.com/ericdaniels22/Nookleus).

The one still-current ground-truth file here is:

- [[00-glossary]] — names, terms, and shorthand that recur in conversations

For canonical domain language see `CONTEXT.md`, and for decisions see `docs/adr/`, both at the repo root. If your training or memory contradicts the code or an open issue, defer to the repo.

## Folders

- `agents/` — Nookleus-internal AI agents (Jarvis, future agents)
- `platform-skills/` — reusable capabilities that platform agents compose
- `builds/` — one card per build with shipped / in-progress / planned status
- `decisions/` — non-obvious decisions worth preserving (ADR-style)
- `data-sources/` — significant Supabase tables and external APIs
- `_templates/` — Templater plugin stubs (the handoff template was removed with the retired loop)

## Conventions

- **Wikilinks over hard paths.** Cross-references use `[[note-name]]` so files can move without breakage.
- **Tags drive status.** `#status/shipped`, `#status/in-progress`, `#status/planned`, `#build/65a`, `#area/mobile`.
- **Frontmatter drives metadata.** `build_id`, `phase`, `started`, `shipped`, etc.
- **Markdown only.** Anything in the vault must read sensibly as plain markdown without Obsidian.
- **The repo is the source of truth.** Build guide docx files cover specs through Build 17 only — anything later is read from migrations, routes, and commits, not from a guide doc.

## Maintenance

This vault is no longer auto-maintained. The `/handoff` + `/orient` skills and the `00-NOW.md` log that kept it current were retired on 2026-06-05 (see [ADR 0010](../adr/0010-retire-knowledge-vault-continuity-loop.md)). The folders above are kept as a curated, frozen reference; current state lives in GitHub issues. The retired loop's files (`00-NOW.md`, the dated handoffs) remain recoverable from the `vault-loop-retired` git tag, e.g. `git show vault-loop-retired:docs/vault/00-NOW.md`.
