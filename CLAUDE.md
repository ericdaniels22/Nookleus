@AGENTS.md

## Project state and continuity

Work plans, feature builds, and current state live in **GitHub issues**
(github.com/ericdaniels22/Nookleus) — the source of truth for what's in
flight and what's next.

For language and decisions, read as needed:

- `CONTEXT.md` — the domain glossary (canonical names/terms)
- `docs/adr/` — architectural & ops decisions and their rationale
- `docs/vault/00-glossary.md` — product names & build-numbering lore

If your training or memory contradicts the code or an open issue, defer to
the repo. Verify against source before acting.

_(The previous knowledge-vault continuity loop — `00-NOW.md`, dated
handoffs, and the `/handoff` + `/orient` skills — was retired 2026-06-05;
see [ADR 0010](docs/adr/0010-retire-knowledge-vault-continuity-loop.md). The
curated vault under `docs/vault/` remains as frozen reference.)_

## Agent skills

### Issue tracker

Issues live in GitHub at github.com/ericdaniels22/Nookleus, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Using the canonical five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repo root (created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
