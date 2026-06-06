# Templates

Templater plugin templates used in Obsidian to scaffold new vault entries with the right frontmatter and section structure.

These are Templater stubs for scaffolding new vault entries with the right frontmatter and section structure. (The companion `handoff.md` template was removed when the knowledge-vault continuity loop was retired — see [ADR 0010](../../adr/0010-retire-knowledge-vault-continuity-loop.md).)

## Conventions

- **Filename:** matches the destination folder's singular form: `build.md` for `builds/`, `decision.md` for `decisions/`, etc.
- **Templater configuration:** Obsidian → Settings → Templater → "Template folder location" set to `docs/vault/_templates`.
- **Reference Templater syntax:** `<% tp.date.now("YYYY-MM-DD") %>`, `<% tp.file.title %>`, etc.

## Files

- `build.md` — for `builds/build-{id}.md`
- `agent.md` — for `agents/{name}.md`
- `platform-skill.md` — for `platform-skills/{name}.md`
- `decision.md` — for `decisions/{YYYY-MM-DD}-{slug}.md`
