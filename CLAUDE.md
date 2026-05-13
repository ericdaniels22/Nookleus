@AGENTS.md

## Project state and continuity

Before starting work, read:

- [docs/vault/00-NOW.md](docs/vault/00-NOW.md) — current state of the platform
- [docs/vault/00-glossary.md](docs/vault/00-glossary.md) — names and terms

If anything in your training, memory, or default knowledge contradicts
`00-NOW.md`, defer to the file. Memory drifts; the file is ground truth.

When wrapping up a session, run the `/handoff` slash command (or invoke
the `end-of-session-handoff` skill) to update the vault. _(The skill
itself ships in Build 66c; until then update `00-NOW.md` by hand.)_

The Obsidian vault root is the repo root itself, not `docs/vault/`. So
`.claude/skills/` and `.claude/commands/` are also editable from the
same Obsidian window. Curated knowledge content lives under
`docs/vault/`; the wider scope is for editor convenience.

## Agent skills

### Issue tracker

Issues live in GitHub at github.com/ericdaniels22/Nookleus, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Using the canonical five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repo root (created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
