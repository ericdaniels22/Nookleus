---
title: Build 67e — Line item name (title) on estimates and invoices
date: 2026-05-06
build_id: 67e
parent_build: 67
predecessor: 67d
status: design — pending plan
---

# Build 67e — Design

When a user adds a line item from the Item Library to an estimate or invoice, the library item's `name` (title) is dropped. Only `description` flows through to the line item, the builder UI, and the exported PDF. Customers see PDFs with bare description text and no item title — a regression vs. industry-standard invoice presentation. Expected behavior: both `name` and `description` carry through and render — `name` as a bold primary line, `description` below in muted secondary text.

## 1. Bug surface

Reproduced 2026-05-06 on `aaaplatform.vercel.app`, draft invoice `JOB-2026-0019-INV-1`.

Library modal shows e.g.:

- **Asbestos Testing** (library `name`) · sample collection (drywall, joint compound, insulation), PLM lab analysis, and written report (library `description`)

After clicking "+ Add", the builder row and PDF Description column show only the description string. The `name` is silently discarded at the AddItemDialog → POST step.

## 2. Root cause — fully traced

Three places drop the name:

1. **Schema** — `estimate_line_items` and `invoice_line_items` have only a `description text NOT NULL` column. No `name` / `title` column. ([supabase/migration-build67a-estimates-foundation.sql:127](supabase/migration-build67a-estimates-foundation.sql:127), [:294](supabase/migration-build67a-estimates-foundation.sql:294))
2. **AddItemDialog** — POST body is `{ section_id, library_item_id, quantity }` only. Library `name` is never sent. ([src/components/estimate-builder/add-item-dialog.tsx:169-173](src/components/estimate-builder/add-item-dialog.tsx:169))
3. **API routes** — `SELECT description, code, default_unit, unit_price, is_active` from `item_library`. `name` never read. INSERT writes only `description`. ([src/app/api/estimates/[id]/line-items/route.ts:80](src/app/api/estimates/[id]/line-items/route.ts:80), [src/app/api/invoices/[id]/line-items/route.ts:60](src/app/api/invoices/[id]/line-items/route.ts:60))

Quirk: template mode in AddItemDialog sets `description: libItem.name` ([line 154](src/components/estimate-builder/add-item-dialog.tsx:154)) — opposite mistake. After 67e, both modes populate `name` and `description` consistently.

Convert RPC ([supabase/migration-build67d-soft-delete-estimates-invoices.sql:181](supabase/migration-build67d-soft-delete-estimates-invoices.sql:181)) currently copies only `description` from estimate to invoice line items — must be extended in the same migration to copy `name`.

Builder + PDF render only `description`:
- [src/components/estimate-builder/line-item-row.tsx:186-202](src/components/estimate-builder/line-item-row.tsx:186) — single `<input>` for description, no name field rendered.
- [src/lib/pdf-renderer/components/sections-table.tsx:63](src/lib/pdf-renderer/components/sections-table.tsx:63) — `<Text style={styles.tdDesc}>{item.description}</Text>` only.

## 3. Decisions locked during brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Schema approach | **Add nullable `name text` column** to both `estimate_line_items` and `invoice_line_items`. Rejected: concat into `description` (smears two fields, future migration cliff). |
| 2 | UI treatment in builder | **Bold name on its own line, muted description below.** Both editable inputs. |
| 3 | UI treatment in PDF | **Same — bold name above muted description** in the Description column. |
| 4 | Existing rows | **Leave `name = NULL`.** Renderers degrade gracefully (no title block when null). No backfill from descriptions. |
| 5 | Convert RPC | **Update `convert_estimate_to_invoice` to copy `name`** in the same migration. |
| 6 | Apply-template RPC | **Investigate during plan.** If it copies line items, must be updated. |
| 7 | Migration filename | `migration-build67e-line-item-name.sql` |
| 8 | Permission gate | **Reuse existing `edit_estimates` / `edit_invoices`** — no new permission keys. |

## 4. Deliverables

1. **Migration `supabase/migration-build67e-line-item-name.sql`**:
   - `ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS name text` (nullable).
   - `ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS name text` (nullable).
   - `CREATE OR REPLACE FUNCTION convert_estimate_to_invoice` — extend the line-item loop's SELECT cursor to include `name` and the INSERT column list + VALUES to include `v_item.name`.
   - If apply-template RPC creates line items: same treatment.
   - Pre-flight reminder: capture full existing function bodies via `pg_get_functiondef` before drafting, same lesson as 67d / 67c1 / 67c2.

2. **Type updates** in `src/lib/types.ts`: add `name: string | null` to `EstimateLineItem` and `InvoiceLineItem`.

3. **API routes** — POST + PUT for both estimates and invoices:
   - `src/app/api/estimates/[id]/line-items/route.ts` POST: extend library SELECT to include `name`; INSERT with `name: lib.name`.
   - `src/app/api/invoices/[id]/line-items/route.ts` POST: same.
   - `src/app/api/estimates/[id]/line-items/[item_id]/route.ts` PUT: accept optional `name` in body, validate (string, max length TBD — 500?), include in UPDATE.
   - `src/app/api/invoices/[id]/line-items/[item_id]/route.ts` PUT: same.

4. **AddItemDialog** ([src/components/estimate-builder/add-item-dialog.tsx](src/components/estimate-builder/add-item-dialog.tsx)):
   - Estimate/invoice mode (line 169-173): no client change required (API derives name from library item).
   - Template mode (line 150-160): swap the current `description: libItem.name` hack for separate `name: libItem.name` + `description: libItem.description` fields. Verify the parent `onAdded` callback in `estimate-builder` template branch can read both.

5. **LineItemRow** ([src/components/estimate-builder/line-item-row.tsx](src/components/estimate-builder/line-item-row.tsx)):
   - Render bold name input on its own line above the description input, when name is present (or always, with placeholder "Item name" when null).
   - Auto-save name on blur, mirroring the existing description commit pattern.
   - Layout: stack vertically — `<input name>` (font-semibold) on top, `<input description>` (text-muted-foreground) below; drag handle + code + qty + unit + price + total stay on the right side aligned with the name row (the visually primary row).

6. **PDF SectionsTable** ([src/lib/pdf-renderer/components/sections-table.tsx:63](src/lib/pdf-renderer/components/sections-table.tsx:63)):
   - Replace the single `<Text style={styles.tdDesc}>{item.description}</Text>` with a stacked View: bold name on top (when non-null), muted description below.
   - Add new styles `tdName` (bold, default text color) and adjust `tdDesc` to muted color when name is also rendered.

## 5. Out of scope

- Backfilling existing line items with names guessed from descriptions. NULL is the correct value for legacy rows.
- Touching the contract-template work in flight on the Mac.
- Adding a name column to the `xactimate_code`-style retired columns or anywhere else.
- Item Library editor changes — the library already has `name` as a separate field.
- AddItemDialog visual changes — it already shows name + description separately in the picker list.

## 6. Verification (§11 plan target)

1. **Add from library — happy path.** Open `/jobs/[id]` → "+ New Estimate" → Add Item from library → builder row shows bold name above muted description → reload → still rendered correctly → Export PDF → PDF Description cell shows bold name above muted description.
2. **Convert preserves name.** From the same estimate, click Convert → resulting invoice's line items show name preserved → PDF of the invoice shows the same bold name layout.
3. **Apply-template preserves name.** Create a template with a name'd line item → apply to a new estimate → template line items carry name through.
4. **Existing pre-67e estimates render cleanly.** Open an estimate created before 67e → rows render with description only, no broken layout, no NULL artifacts visible.
5. **Edit name in builder.** Click name input on a line item → type → blur → reload → name persisted. Description unchanged.
6. **Edit description in builder.** Click description input → type → blur → reload → description persisted. Name unchanged.
7. **Custom item path.** Add a custom (non-library) item → name input is editable from the start → save → reload → persists.
8. **Permission gate.** As `crew_lead` (no `edit_estimates`), name input is read-only or hidden, same as description today.
9. **Multi-tenant.** Verify in Test Co + AAA Disaster Recovery; no leakage.

## 7. Open questions for the plan author

- **Q1: Apply-template RPC** — does it INSERT into `{estimate,invoice}_line_items`? If so, the migration must update it. Read [supabase/migration-build67b-conversion-and-template-apply.sql](supabase/migration-build67b-conversion-and-template-apply.sql) and any subsequent template RPC migrations during plan write.
- **Q2: Custom-item name validation** — for the POST custom path (no `library_item_id`), is `name` required, optional, or always derivable from description? Recommend optional; if user provides only description, name stays NULL and renders as "description-only" row (matching legacy).
- **Q3: AddItemDialog Custom tab** — does it need a name field added? Yes if custom items should be able to have names; check current Custom tab UX during plan.
- **Q4: name max-length** — `description` is capped at 2000 ([line 115 of estimate POST route](src/app/api/estimates/[id]/line-items/route.ts:115)). Suggest 500 for `name`. Confirm during plan.
- **Q5: Edit history / audit** — name edits don't currently write to any audit log (consistent with description). Leave as-is.

## 8. Risk + rollback

- **Migration is additive + nullable** — non-blocking on Postgres for both tables. Existing rows untouched. Reversible with `DROP COLUMN name` (would lose any user-written names; acceptable since the rendered shape with NULL is identical to today).
- **Convert RPC** — if the SELECT cursor or INSERT list misses `name`, conversions silently drop names from invoice line items. Mitigation: verify with a manual convert in §11 Test 2 before declaring done.
- **TypeScript types** — adding `name: string | null` to interfaces is purely additive. No call sites should break unless they construct a literal line item without spreading existing fields. Grep for `EstimateLineItem` and `InvoiceLineItem` literals during plan.
- **PDF renderer** — react-pdf View nesting inside a Text cell can break layout. Test in Test 1 + 2.

## 9. Coordination

- Mac session (parallel) is on contract templates ([build-15a/b/c] lineage). Zero overlap with this build's surface area:
  - `estimate_line_items` / `invoice_line_items` — estimate/invoice only
  - `lib/types.ts` `EstimateLineItem` / `InvoiceLineItem` — additive, won't collide with contract type additions
  - PDF SectionsTable — estimate/invoice section table specifically, not the contract document renderer
- Worktree `claude/crazy-saha-20b6b1` (this branch) is the execution surface. After merge, Mac rebases on next pull; standard.

---

**Hand-off note:** This spec was written 2026-05-06 from a debugging session that traced the bug end-to-end. Continue with `/superpowers:plan` (or equivalent) against this file in the fresh session to expand into a task-by-task implementation plan, then dispatch SDD subagents per the [build-67c1] / [build-67d] pattern. The vault's `00-NOW.md` is current as of HEAD `7dd1a10` (65a TestFlight build 3 ship) — read it for orientation before planning.
