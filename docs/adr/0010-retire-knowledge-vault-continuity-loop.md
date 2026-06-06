# Retire the knowledge-vault continuity loop

**Status:** Accepted
**Date:** 2026-06-05

## Context

The Obsidian vault under `docs/vault/` grew a **continuity loop** intended to
carry platform state across agent sessions:

- **`docs/vault/00-NOW.md`** — a single, append-only "current state of the
  platform" log that every session was told to read first and treat as ground
  truth.
- **`docs/vault/handoffs/`** — 141 dated session-end notes, one per working
  session.
- **`.claude/skills/end-of-session-handoff/`** + **`.claude/commands/handoff.md`**
  — wrote a new handoff and updated `00-NOW.md` at the end of a session.
- **`.claude/skills/start-of-session-orientation/`** + **`.claude/commands/orient.md`**
  — read `00-NOW.md` + recent handoffs at the start of a session.
- **`docs/vault/_templates/handoff.md`** — the handoff note template.

CLAUDE.md wired this together in prose: read `00-NOW.md` first, defer to it over
training/memory, and run `/handoff` when wrapping up.

Three things made the loop a net cost rather than a benefit:

1. **The ritual fell out of use.** The handoff→orient cycle stopped being run
   reliably, so `00-NOW.md` and the handoffs drifted from reality — the opposite
   of "ground truth."
2. **`00-NOW.md` was an always-read tax.** It had grown to ~656 KB. Because
   CLAUDE.md told every session to read it first, that cost was paid at the start
   of work that often had nothing to do with most of the file.
3. **GitHub issues became the real source of truth.** Work plans and feature
   builds now live in issues at github.com/ericdaniels22/Nookleus. They are
   maintained as a matter of course and already describe what is in flight and
   what is next — duplicating, and outrunning, `00-NOW.md`.

The loop was **entirely model-driven** — it lived in CLAUDE.md prose and the two
skills' frontmatter. No hook, CI step, or settings file invoked it. Removing it
therefore breaks no automation; it is a documentation and prompt change.

## Decision

1. **Retire the loop.** Delete `00-NOW.md`, `handoffs/`, the two skills
   (`end-of-session-handoff`, `start-of-session-orientation`), the two commands
   (`/handoff`, `/orient`), and `_templates/handoff.md`.

2. **Keep the curated reference content.** `docs/vault/00-glossary.md`,
   `decisions/`, `data-sources/`, `builds/`, `agents/`, and `platform-skills/`
   carry curated knowledge that is not in the code or in issues. They stay. The
   vault becomes a **frozen reference archive**, no longer a live-updated state
   log.

3. **Redirect continuity to the repo and issues.** CLAUDE.md's "Project state
   and continuity" section is rewritten to point at **GitHub issues** (in-flight
   and upcoming work), **CONTEXT.md** (the domain glossary), and **docs/adr/**
   (decisions and their rationale).

4. **Salvage non-derivable footguns first.** Six lessons that lived only in the
   doomed files were extracted verbatim before deletion and rehoused where the
   relevant code or decision lives — see *Consequences*.

5. **Preserve the deleted content via an annotated git tag.** `vault-loop-retired`
   is tagged at the pre-retirement commit. Any deleted file is recoverable with
   `git show vault-loop-retired:docs/vault/00-NOW.md` (or any other path).

## Consequences

- **Session start no longer pays the `00-NOW.md` context cost.** Orientation is
  now "read the open issues, and CONTEXT.md / ADRs as needed."
- **The 141-file handoff history and the 656 KB state log leave the working
  tree** but remain recoverable from the `vault-loop-retired` tag. The history
  has occasional forensic value; tagging is cheap, hard-deletion was not worth
  the irreversibility.
- **The six salvaged footguns survive independently of the vault.** Signed-PDF
  immutability became [ADR 0011](0011-signed-contract-pdfs-are-immutable.md). The
  estimate-snapshot child-write guard and the autosave timeout / two-halves
  re-baseline became expanded code comments in `src/lib/estimates.ts` and
  `src/components/estimate-builder/use-auto-save.ts`. Three environment/working
  footguns (subagents can't reach prod Supabase; Capacitor/iOS WebKit gotchas;
  the grep-scope / preflight / rule-of-three discipline heuristics) became
  auto-memory entries.
- **Build cards that documented building the loop** (`builds/build-66a..66d`) are
  kept as historical record with a retirement banner pointing here. Build cards
  whose frontmatter linked dated handoffs have those wikilinks nulled or
  de-linked so nothing dangles.
- **Do not recreate the loop.** If a durable "current state" document is wanted
  again, it should be small, deliberately scoped, and a new decision — not a
  revival of the always-read mega-log.

## Considered options

- **Keep the loop, just trim `00-NOW.md`.** Rejected: the ritual was unused and
  issues already serve the purpose. Shrinking a file nobody reads fixes the
  symptom, not the disuse.
- **Delete the whole vault, curated content included.** Rejected: the glossary,
  decision cards, data-source notes, and build cards hold curated knowledge that
  is not reconstructible from code or issues.
- **Replace `00-NOW.md` with a small hand-maintained `STATUS.md`.** Rejected for
  now: GitHub issues already hold in-flight state, and a second hand-maintained
  file would drift the same way the loop did. Left open as a future decision if a
  real need appears.
- **Hard-delete with no archive.** Rejected: the `vault-loop-retired` tag costs
  nothing and keeps the handoff history recoverable.
