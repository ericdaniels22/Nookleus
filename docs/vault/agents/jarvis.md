---
agent: jarvis
status: shipped
phase: jarvis-ecosystem
related_builds: ["[[build-21]]", "[[build-23]]", "[[build-25a]]", "[[build-26b]]"]
related_skills: ["[[agent-registry]]", "[[jarvis-tools]]", "[[knowledge-search]]", "[[knowledge-ingestion]]", "[[claude-tool-loop]]", "[[system-prompts]]"]
---

#agent #area/jarvis #status/shipped

# Jarvis

Nookleus's in-platform AI assistant. **Shipped.** A Claude-powered orchestrator with three specialist sub-agents, full job/business context, and a RAG knowledge base for IICRC restoration standards.

## Surfaces

- **`/jarvis`** — chat UI with right-side conversation list and admin-only mode toggle (Jarvis / R&D / Marketing / Field Ops). Mode is persisted on the conversation row (`context_type`).
- **`/marketing`** — dedicated marketing tab UI (Social Media + Chat). The Chat tab is just the Marketing sub-agent in a different surface.
- **`/settings/knowledge`** — admin RAG ingestion + test-search UI for the knowledge base.

## API endpoints

| Endpoint | Agent | Model | Notes |
|---|---|---|---|
| `/api/jarvis/chat` | jarvis-core | Claude Sonnet | Main orchestrator; routes to specialists |
| `/api/jarvis/rnd` | rnd | Claude Opus | `max_tokens: 16384`, `timeout: 120s` |
| `/api/jarvis/field-ops` | field-ops | Claude Sonnet | `max_tokens: 8192`, `timeout: 60s` |
| `/api/jarvis/marketing` | marketing | Claude Sonnet | `max_tokens: 8192`, `timeout: 60s` |
| `/api/knowledge/search` | (RAG) | — | Vector search over IICRC standards |
| `/api/knowledge/documents` | (admin) | — | List/manage uploaded standards |
| `/api/knowledge/ingest` | (admin) | — | PDF/DOCX upload + chunking + embed |
| `/api/marketing/assets`, `/api/marketing/drafts` | (admin) | — | Marketing storage |

## The four agents

Defined in [src/lib/jarvis/agent-registry.ts](../../../src/lib/jarvis/agent-registry.ts). All cards below cite that file as ground truth.

### Jarvis Core

The orchestrator. Built [[build-21]] (commit `f97e4d6`, `4384bb8`).

- **Role:** routes to specialized departments, handles general conversation, has business-wide visibility.
- **Tools:** `get_job_details`, `search_jobs`, `get_business_metrics`, `log_activity`, `create_alert`, `consult_rnd`, `consult_marketing`. See [[jarvis-tools]].
- **System prompt:** [src/lib/jarvis/prompts/jarvis-core.ts](../../../src/lib/jarvis/prompts/jarvis-core.ts). Persona is mission-driven — explicit values, witty/playful, departmental routing rules baked in.
- **Context fed in:** active user (name + role), optional job context (when `context_type === 'job'`), optional business snapshot (active job count, jobs by status, total outstanding, overdue count).

### R&D Department

Platform-improvement specialist. Built [[build-23]] (commit `a1b6e79`).

- **Role:** platform improvement, technology research, bug diagnosis, build spec generation.
- **Tools:** `read_project_structure`, `read_file`, `check_system_health`, `check_recent_errors`, `query_database`, `web_search`.
- **DB access:** the SQL function `execute_readonly_query()` (SELECT-only, 100-row limit, blocked dangerous keywords) — see migration build23.
- **System prompt:** [src/lib/jarvis/prompts/rnd.ts](../../../src/lib/jarvis/prompts/rnd.ts). Claude Opus.

### Field Operations

IICRC-grounded restoration guidance. Built [[build-25a]] (commit `45be1a6`, with Build 2.4).

- **Role:** IICRC standards-backed restoration guidance for water (S500), mold (S520), fire/smoke (S700) jobs.
- **Tools:** `get_job_context`, `get_moisture_readings`, `get_safety_alerts`, `search_knowledge_base`. See [[knowledge-search]].
- **Knowledge sources** declared in registry: S500 Quick Reference, S520 Quick Reference, S700 Reference, plus the full standards via pgvector RAG.
- **System prompt:** [src/lib/jarvis/prompts/field-ops.ts](../../../src/lib/jarvis/prompts/field-ops.ts).

### Marketing Department

Digital marketing content. Built [[build-26b]] (commit `99fde06`, with Build 2.6a).

- **Role:** Google Ads, SEO, social media, GBP, website copy, review responses, LLM optimization.
- **Tools:** `web_search`, `get_business_info`, `get_services_list`.
- **System prompt:** [src/lib/jarvis/prompts/marketing.ts](../../../src/lib/jarvis/prompts/marketing.ts).
- **Surface:** dual — the `/jarvis` Marketing mode and the dedicated `/marketing` page (which adds Social Media tab + image library + drafts).

## Conversation persistence

`jarvis_conversations` table (built in [[build-21]]):

- One row per chat thread. `context_type` enum: `general`, `job`, `rnd`, `marketing`, `field-ops`.
- `messages jsonb` stores the entire transcript including tool calls/results.
- RLS: users see their own conversations; admins read all.

## Reusable internal capabilities (platform skills)

- [[agent-registry]] — single source of truth for agent metadata.
- [[jarvis-tools]] — orchestrator tool definitions and execution helper.
- [[knowledge-search]] — pgvector RAG over IICRC standards (used by Field Ops).
- [[knowledge-ingestion]] — PDF/DOCX → chunks → Voyage embeddings (used at upload).
- [[claude-tool-loop]] — the chat-route iteration pattern that runs Anthropic SDK with tool_use until `end_turn` or 5 iterations.
- [[system-prompts]] — per-agent prompt files in `src/lib/jarvis/prompts/`.

## Source

- Build cards: [[build-21]] (Jarvis Chat UI + Claude API), [[build-23]] (R&D), [[build-25a]] (Knowledge + Field Ops), [[build-26b]] (Marketing).
- Code: [src/app/jarvis/page.tsx](../../../src/app/jarvis/page.tsx), [src/app/api/jarvis/](../../../src/app/api/jarvis/), [src/components/jarvis/](../../../src/components/jarvis/), [src/lib/jarvis/](../../../src/lib/jarvis/).
