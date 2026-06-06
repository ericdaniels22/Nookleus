# Glossary

Names, terms, and shorthand that recur across Nookleus work. New terms get added the moment they're coined. Format: **bolded term** — definition.

## Product and identity

- **Nookleus** — product name, locked 2026-04-21 as the rebrand of `aaa-platform`. iOS-first rollout is done; web still shows "AAA Disaster Recovery" until a separate-domain decision is made.
- **AAA Disaster Recovery** — first tenant org in the multi-tenant system; doubles as the public-facing brand on web until the Nookleus rollout reaches the web layer.
- **aaa-platform** — original repo name, still the GitHub repo slug at `github.com/ericdaniels22/aaa-platform`.

## Machines and environments

- **TheLaunchPad** — Eric's primary Windows dev machine. _(Note: earlier spec drafts described this as a borrowed Mac. Current reality is Windows; the Mac used for iOS work is referenced separately as "the Mac.")_
- **The Mac** — used for iOS / Xcode work. Access is intermittent, hence the recurring "Mac access" thread.

## Platform features

- **Jarvis** — Nookleus's in-platform AI assistant ecosystem. **Shipped** at `/jarvis` and `/api/jarvis`, with the knowledge base at `/settings/knowledge`. Four agents (Jarvis Core, R&D, Field Ops, Marketing) — see [[jarvis]]. Backed by **migrations 21, 23, 25a, 26b**. Embeds the Claude API with full job context.
- **Knowledge base** — Jarvis's pgvector RAG store at `/settings/knowledge`. Voyage AI embeddings (`voyage-3.5-lite`, 1024-d). See [[knowledge-search]] and [[knowledge-ingestion]].
- **Marketing sub-agent (Jarvis)** — Jarvis specialist for Google Ads, SEO, social media, GBP, website copy, review responses, LLM optimization. Backed by migration **26b** (`marketing_assets`, `marketing_drafts`) and [[build-26b]]. Surfaced in two places: the Marketing mode toggle inside `/jarvis`, and the dedicated `/marketing` page (Social Media + Chat tabs). **Not in any build guide doc.**
- **Native document viewer** — the original mechanism for the Estimate/Invoice **View** surface (#385): a bare `<iframe>` streaming the `/preview` PDF so the **browser's** built-in PDF chrome (toolbar + thumbnail sidebar) renders it. Its sidebar width is browser-controlled and uncontrollable from our CSS — exactly what #457 hit. Superseded on document Views by the **in-app document viewer** (#463, [ADR 0013](../adr/0013-in-app-document-viewer-replaces-native-pdf-iframe.md)).
- **In-app document viewer** — Nookleus's own `react-pdf` (pdf.js) viewer for the customer-facing Estimate/Invoice PDF on the View surface, replacing the **native document viewer**. Renders the same byte-for-byte `/preview` PDF in continuous scroll, fit-to-width, so we control the layout — including the slim **page picker**. Read-only; editing still lives in the builder. Reuses the contracts viewer's `react-pdf` island + `configurePdfjs` worker config.
- **Page picker** — the slim thumbnail rail down the side of the **in-app document viewer**: click a thumbnail to jump to that page, and it marks the page you are on. Coined in #457, where the browser's native version was eating ~half the viewer width; once we own the viewer it is slimmed to ~a quarter.

## Multi-tenant infrastructure

- **18a / 18b / 18c** — multi-tenant SaaS rollout. 18a schema + backfill, 18b RLS enforcement, 18c workspace switcher. All shipped (migrations 42–63).
- **Build 64** — restoration of the `handle_new_user` trigger that 18b accidentally dropped.

## Mobile (Build 65 series)

- **Build 65a** — Capacitor iOS shell. Shipped to TestFlight as Nookleus.
- **Build 65b** — camera UI (queued).
- **Build 65c** — upload pipeline (queued).
- **Build 65d** — mobile audit (queued).
- **Build 65e** — App Store submission (queued).

## Numbering schemes

- **Build IDs vs migration numbers diverge after Build 14.** The two numberings are not the same thing:
  - **Build ID** is the project's roadmap label (`16a`, `16b`, `17c`, `18a`, etc.). Letters denote sub-builds within a parent number.
  - **Migration number** is the global sequential counter on `supabase/migration-buildN-*.sql` files.
  - Through Build 14 they line up (Build 14a → migration build14a). After that they diverge — Build 16a is migration build35, Build 17c is migration build41, [[build-18a]] spans build42 through build54, [[build-21]] is migration build21 (which happens to coincide), etc.
  - Future Claude: when you see "Build 16a" in conversation and then a `migration-build35.sql` file in the diff, that's the same thing. Don't try to reconcile the numbers — read the migration content.
- **Build 66 overload.** The label "Build 66" is shared by two unrelated threads:
  - **[[build-66]]** — soft-delete jobs + 30-day trash, PR #37, migration `build66-soft-delete-jobs`. Shipped.
  - **[[build-66a]] / [[build-66b]] / [[build-66c]] / [[build-66d]]** — Knowledge Vault meta-spec sub-builds. The Knowledge Vault meta-spec used the label "Build 66" while the migration counter independently advanced to 66 for soft-delete. They are not the same project.

## Lessons and gotchas

- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`. Use empty strings instead, never NULL. See [[2026-04-22-build52-null-tokens-lesson]].

## Process and tooling

- **superpowers** — internal name for the planning / handoff document discipline. Lives in `docs/superpowers/`.
- **Vault** — this folder, `docs/vault/`. Curated knowledge content. Stood up in Build 66a; populated by Build 66b. The Build 66c maintenance loop (`00-NOW.md` + dated handoffs + the `/handoff` / `/orient` skills) was retired 2026-06-05 — see [ADR 0010](../adr/0010-retire-knowledge-vault-continuity-loop.md). The folder is now a frozen reference; current platform state lives in GitHub issues.
- **Build guide docs are incomplete.** The four `.docx` files (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17 only. Builds 18, 21, 23, 25a, 27, 28, 29, 30, 31, 64, 65 shipped without ever being written into a guide doc. **The repo is the only source of truth for what shipped.**
- **Rule C finding** — established triage rule: minor finding → log + proceed; material finding → stop + hand back.
