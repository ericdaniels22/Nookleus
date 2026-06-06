# Decisions

ADR-style records of non-obvious decisions. Anything where "we chose X over Y because Z" is worth preserving for the future Claude (or future Eric) who will wonder why the code looks the way it does.

## When to write a decision card

- Architectural decisions (e.g. why the vault root is the repo root, not `docs/vault/`)
- Tooling choices that lock out alternatives (e.g. Capacitor over a native rewrite)
- Naming locks (e.g. the Nookleus rebrand)
- Tradeoff resolutions where the rejected option still seems reasonable

## When NOT to write one

- Anything obvious from the code
- Bug fixes (the commit message is enough)
- Personal preferences with no platform impact

## Conventions

- **Filename:** `{YYYY-MM-DD}-{slug}.md` (e.g. `2026-04-21-rename-to-nookleus.md`).
- **Tags:** `#decision`, plus relevant area tags.
- **Frontmatter:** `date`, `title`, `status` (`accepted` | `superseded` | `rejected`), `supersedes`, `superseded_by`, `related`.
- **Sections:** Context · Decision · Alternatives considered · Consequences · Links.
- **Wikilinks:** to the build cards where the decision was made or first applied.
