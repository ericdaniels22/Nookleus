# Builds

One card per build. Builds are the unit of work in the Nookleus repo — every shipped feature traces back to a build.

## Conventions

- **Filename:** `build-{id}.md` where the id matches commit references (e.g. `build-65a.md`, `build-18c.md`, `build-66a.md`).
- **Tags:** exactly one status tag — `#status/shipped`, `#status/in-progress`, or `#status/planned`. Plus area tags like `#area/mobile`, `#area/payments`, `#area/multi-tenant`.
- **Frontmatter:**

  ```yaml
  build_id: 65a
  title: Capacitor iOS scaffold
  status: shipped
  phase: mobile
  started: 2026-04-26
  shipped: 2026-04-28
  guide_doc: null              # or "v1.7 §Build 17" if specced in a docx
  plan_file: docs/superpowers/plans/2026-04-26-build-65a-scaffold.md
  handoff: null                # retired with the continuity loop — see ADR 0010
  related: ["[[build-65b]]", "[[build-18c]]"]
  ```

- **Wikilinks:** link related builds and any platform / data-source cards that this build touched. (The old per-card handoff link is retired — see [ADR 0010](../../adr/0010-retire-knowledge-vault-continuity-loop.md).)

## Sections each card should have

1. **What shipped** — concrete deliverables (migrations, routes, components, API endpoints). Cite file paths.
2. **Source** — guide doc + section, plan file, handoff, commit range — whichever exists.
3. **Open threads** — anything left over for follow-up builds.

The build cards get backfilled from existing artifacts in Build 66b.
