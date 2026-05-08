---
date: 2026-05-01
build_id: 67b
status: design-approved
author: Claude (Eric authoring)
related:
  - "[[build-67a]]"
  - "[[build-17a]]"
  - "[[build-17c]]"
  - "[[build-38]]"
source_prompts:
  - ~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md (sections 5.2, 5.4, 5.7, 7)
  - docs/superpowers/specs/2026-04-30-build-67a-estimates-foundation-design.md
  - docs/vault/handoffs/2026-05-01-build-67a-2.md (cleanup-session "Notes for next session")
---

# Build 67b — Templates, Conversion, Invoice Editor

## 1. Why this exists

67a delivered the data foundation, the Item Library, and the estimate builder end-to-end. 67b adds the three features that make the estimate→invoice loop a real product:

- **Estimate Templates** so Eric stops rebuilding "Standard Water Mitigation" by hand on every new job.
- **Estimate→Invoice conversion** so an approved estimate becomes the starting point for the invoice (the daily-use feature for Nookleus's actual workflow).
- **Invoice editor** that matches the estimate builder feature-for-feature (sections, subsections, line items, statements, markup/discount/tax, auto-save) — replacing the pre-67a invoice editor that was Build 17/38 era.

After 67b ships:
- Eric can manage reusable estimate templates with damage-type-tagged structure + statements.
- Empty new estimates show a "Start from a template?" banner with damage-type-matched suggestions.
- Approved estimates have a Convert button that atomically copies content to a new INV-N invoice and marks the estimate Converted.
- Invoices have a real builder identical in shape to the estimate builder — replacing the broken old POST route silently bricked by 67a's NOT NULL ALTERs.
- The job-detail page shows both estimates and invoices with linkage badges.

## 2. Inheritance from 67a + build guide

The build guide (`~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md` sections 5.2, 5.4, 5.7, 7) is the canonical 67b spec; 67a's design doc inherited from it for the schema split. This document refines the build guide against the actual 67a-shipped state — eight points where the build guide is stale or silent and 67b needs a concrete answer:

| Stale/silent in build guide | 67b resolution |
|---|---|
| "Build invoice editor" assumed no invoice UI existed | Existing 4 client components + 3 pages + 5 API routes are real and on the pre-67a schema. **Replace create/edit; keep read-only detail + payment surface (Stripe modal, record-payment, mark-sent / send / pdf routes) untouched.** Old POST is silently broken since 67a's NOT NULL ALTERs — 67b's editor unbreaks it. |
| Auto-save hook hardcoded to estimate | **Generic-ify with `AutoSaveConfig<T>` config object** — single hook, three call sites pass `{ baseUrl, paths, snapshotKey, payloadShape }`. Templates skip the snapshot-409 dance. |
| Builder components have no `mode` prop | **Add `mode: 'estimate' \| 'invoice' \| 'template'` to all 11 files in `src/components/estimate-builder/`.** Prop-drill (no context provider, chain max 3 levels). |
| Status transition UI doesn't exist on the estimate yet | 67a's HeaderBar has Void only. **67b adds Mark as Sent / Mark Approved / Mark Rejected / Convert to Invoice buttons** plus the invoice-side Mark as Paid / Send Payment Request / Mark as Sent. |
| Build guide says broken-template-ref warnings go to "estimate's activity log" — no activity log exists | **Toast on apply + dismissible persistent banner** keyed by `localStorage` per estimate. |
| Build guide says "Send Payment Request (Build 17 — verify integration point exists)" | Already wired — `<PaymentRequestModal>` exists at `src/components/payments/payment-request-modal.tsx`. Consume it in the new read-only invoice view's HeaderBar. |
| Apply Template UX placement | Build guide's "metadata-bar dropdown when sections=0" reads as awkward. **Use a post-create banner** below MetadataBar: "Start from a template? [dropdown] or click '+ New Section' to start blank." Hides once first apply (any kind) OR sections.length > 0. |
| Voiding rules around conversion | Build guide is verbose but contradictory in places. **Locked: cannot void a converted estimate; voiding child invoice does not un-convert parent estimate; CHECK constraint backstops at DB level.** |

## 3. Scope

### In scope (67b)

- **Estimate Templates** at `/settings/estimate-templates` — full CRUD, card-grid list, builder reuse for the editor in `mode="template"`.
- **Apply Template flow** — post-create banner on empty estimates, atomic populate via `apply_template_to_estimate(p_estimate_id, p_template_id)` RPC, broken-ref fallback + warning surface (toast + dismissible banner).
- **Estimate → Invoice conversion** — atomic `convert_estimate_to_invoice(p_estimate_id)` RPC, plain confirm modal, redirect to invoice editor, idempotency 409 on retry.
- **Invoice editor** at `/jobs/[id]/invoices/new` and `/invoices/[id]/edit` — full builder reuse via `mode="invoice"`, parallel `INV-N` numbering, distinct status set, distinct action buttons.
- **Read-only invoice view** at `/invoices/[id]` — rebuilt for new schema (sections, statements, markup/discount). Payment buttons (`<PaymentRequestModal>`, `<RecordPaymentModal>`) move into this view's HeaderBar.
- **Job-detail integration** — `EstimatesInvoicesSection` extended with the Invoices half (currently a 67a stub); per-row linkage badges (`→ INV-N` / `← EST-M`).
- **Status transition buttons** added to estimate header (Mark as Sent → Mark Approved / Mark Rejected → Convert).
- **Builder shell `mode` prop refactor** across 11 components in `src/components/estimate-builder/`.
- **Generic-ified auto-save hook** at `src/components/estimate-builder/use-auto-save.ts`.

### Out of scope (deferred to 67c)

- PDF preset manager UI at `/settings/pdf-presets` (schema already in 67a).
- New PDF generation for both estimates and invoices using the new schema.
- "Send via Email" button on estimate and invoice (67b ships only "Mark as Sent" — pure status flip).
- Customer-facing approval magic links.

### Cleanup chip closed by 67b

- Pre-67a invoice POST is silently broken on main since 67a's `invoices.title` and `invoices.sequence_number` NOT NULL ALTERs landed. 67b's invoice editor work is the fix.

## 4. Architectural decisions

### 4.1 Builder shell — `mode` prop on existing components

The 11 files in `src/components/estimate-builder/` gain a single `mode: 'estimate' | 'invoice' | 'template'` prop, prop-drilled from the root (no context provider — chain is max 3 levels deep).

Per-mode rendering:

| Aspect | estimate | invoice | template |
|---|---|---|---|
| Status badge | yes | yes | hidden |
| Customer block | yes | yes | hidden |
| Metadata: Issued / Valid Until | yes | hidden | hidden |
| Metadata: Issued / Due / PO Number | hidden | yes | hidden |
| Metadata: Damage Type Tags | hidden | hidden | yes |
| Apply Template banner | yes (when sections=0 AND no localStorage applied flag) | hidden | hidden |
| Header: Mark as Sent | when draft | when draft | hidden |
| Header: Mark Approved / Mark Rejected | when sent | hidden | hidden |
| Header: Convert to Invoice | when approved | hidden | hidden |
| Header: Mark as Paid | hidden | when sent / partial | hidden |
| Header: Send Payment Request | hidden | when not voided / paid | hidden |
| Header: Save Template | hidden | hidden | yes |
| Header: Void | when not voided / converted | when not voided / paid | hidden |
| TotalsPanel | yes | yes | hidden |
| Save dispatch base URL | `/api/estimates/[id]` | `/api/invoices/[id]` | `/api/estimate-templates/[id]` |

### 4.2 Builder entity — discriminated union

```ts
type BuilderEntity =
  | { kind: 'estimate'; data: EstimateWithContents }
  | { kind: 'invoice';  data: InvoiceWithContents }
  | { kind: 'template'; data: TemplateWithContents };
```

Common fields (`id`, `title`, `sections[]`, `opening_statement`, `closing_statement`) read off `entity.data` directly. Mode-specific reads (`markup_type`, `due_date`, `damage_type_tags`) are guarded by a `kind` switch at the consumer. Discriminated union beats a flat optional-field interface because TypeScript narrows correctly inside the switch.

### 4.3 Auto-save hook generic-ification

`use-auto-save.ts` becomes generic over the entity shape — single hook, three call sites pass config:

```ts
interface AutoSaveConfig<T extends { id: string; updated_at?: string | null }> {
  entityKind: 'estimate' | 'invoice' | 'template';
  entityId: string;
  paths: {
    rootPut: string;                                    // PUT entity-level (title, statements, markup, etc.)
    sectionsReorder: string;
    sectionRoute: (sectionId: string) => string;
    lineItemsReorder: string;
    lineItemRoute: (itemId: string) => string;
  };
  serializeRootPut: (entity: T) => unknown;
  hasSnapshotConcurrency: boolean;                      // false for templates
}
```

Templates skip the `updated_at`-snapshot 409 dance (no realistic multi-editor case in this product). Estimates and invoices keep it. The hook's existing exponential-backoff retry, in-flight guard, 404→stale handling, and per-line-item timer-ref machinery all carry over unchanged. The `T extends ...` constraint on `updated_at` uses optional chaining inside the snapshot-guard branch so templates compile.

### 4.4 Builder-shared utilities

`src/lib/builder-shared.ts` is a new module that holds the cross-entity helpers currently in `src/lib/estimates.ts`:

- `touchEntity(supabase, table, id)` — bumps `updated_at` to `now()`. Used by reorder PUT routes for both estimates and invoices.
- `checkSnapshot(supabase, table, id, snapshotIso)` — returns `{ stale: boolean, current: string | null }`. Same signature for both.
- `recalculateMonetary(lineItems, opts) → { subtotal, markup_amount, discount_amount, adjusted_subtotal, tax_amount, total }` — pure, no DB. Both `recalculateTotals(estimateId)` (in `estimates.ts`) and `recalculateInvoiceTotals(invoiceId)` (in new `invoices.ts`) delegate to this for the math, then run the entity-specific UPDATE.

`src/lib/estimates.ts` is refactored to delegate; its public surface is unchanged (no caller breakage).

`src/lib/estimate-status.ts` is extended with `INVOICE_STATUS_BADGE_CLASSES` and a polymorphic `formatStatusLabel(kind, status)`. The 67a single-arg `formatStatusLabel(status)` becomes a thin wrapper for back-compat.

## 5. Schema impact

**Zero new tables.** 67a created everything (`estimate_templates`, `invoice_sections`, `invoices.*` ALTERs, RPC `generate_invoice_number(p_job_id)`).

One new migration: `supabase/migration-build67b-conversion-and-template-apply.sql` with two RPCs and one CHECK constraint.

### 5.1 `convert_estimate_to_invoice(p_estimate_id uuid) RETURNS uuid`

Single transaction, RLS-context-inheriting. Returns the new invoice id.

```sql
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(p_estimate_id uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_estimate estimates%ROWTYPE;
  v_org_id uuid;
  v_job_id uuid;
  v_inv_number text;
  v_inv_seq integer;
  v_due_days integer;
  v_due_date date;
  v_new_invoice_id uuid;
  v_section_map jsonb := '{}'::jsonb;
  -- ... (loop variables)
BEGIN
  -- 1. Lock and validate estimate
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.status <> 'approved' THEN
    RAISE EXCEPTION 'estimate_not_approved' USING ERRCODE = 'P0001';
  END IF;
  IF v_estimate.converted_to_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'estimate_already_converted:%', v_estimate.converted_to_invoice_id
      USING ERRCODE = 'P0001';
  END IF;

  v_org_id := v_estimate.organization_id;
  v_job_id := v_estimate.job_id;

  -- 2. Generate next invoice number (delegates to 67a RPC)
  SELECT (generate_invoice_number(v_job_id)).invoice_number,
         (generate_invoice_number(v_job_id)).sequence_number
    INTO v_inv_number, v_inv_seq;
  -- (single-call refactor in implementation; this sketch shows intent)

  -- 3. Read default due-days from settings
  SELECT COALESCE(value::integer, 30) INTO v_due_days
    FROM company_settings
    WHERE organization_id = v_org_id AND key = 'default_invoice_due_days';
  v_due_date := CURRENT_DATE + v_due_days;

  -- 4. INSERT new invoice
  INSERT INTO invoices (
    organization_id, job_id, invoice_number, sequence_number, title,
    status, issued_date, due_date,
    opening_statement, closing_statement,
    markup_type, markup_value, discount_type, discount_value, tax_rate,
    converted_from_estimate_id, created_by
  ) VALUES (
    v_org_id, v_job_id, v_inv_number, v_inv_seq, v_estimate.title,
    'draft', CURRENT_DATE, v_due_date,
    v_estimate.opening_statement, v_estimate.closing_statement,
    v_estimate.markup_type, v_estimate.markup_value,
    v_estimate.discount_type, v_estimate.discount_value, v_estimate.tax_rate,
    v_estimate.id, auth.uid()
  )
  RETURNING id INTO v_new_invoice_id;

  -- 5. Copy sections (two passes — pass 1 inserts, builds id→id map; pass 2 wires parent_section_id)
  -- 6. Copy line items (uses section map for new section_id)
  -- (full implementation in the migration file; details deferred to writing-plans)

  -- 7. Update estimate
  UPDATE estimates SET
    status = 'converted',
    converted_to_invoice_id = v_new_invoice_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_estimate_id;

  -- 8. Recompute invoice totals
  -- (call equivalent of recalculateInvoiceTotals in-line, or delegate to a helper RPC)

  RETURN v_new_invoice_id;
END;
$$;
```

The route handler at `src/app/api/estimates/[id]/convert/route.ts` maps:
- `estimate_not_found` → 404
- `estimate_not_approved` → 400 ("Estimate must be approved before converting")
- `estimate_already_converted:<uuid>` → 409 with body `{ existing_invoice_id, existing_invoice_number }` (lookup the linked invoice number for the response)

### 5.2 `apply_template_to_estimate(p_estimate_id uuid, p_template_id uuid) RETURNS jsonb`

Returns:
```json
{
  "section_count": 4,
  "line_item_count": 18,
  "broken_refs": [
    { "section_idx": 0, "item_idx": 2, "library_item_id": "uuid-or-null", "placeholder": false },
    { "section_idx": 1, "item_idx": 0, "library_item_id": "uuid", "placeholder": true }
  ]
}
```

Algorithm:
1. `SELECT ... FOR UPDATE` on estimate; raise if not in `draft` status or sections-count > 0 (`SELECT COUNT(*) FROM estimate_sections WHERE estimate_id = p_estimate_id` — the same-transaction lock prevents race).
2. Fetch template by id; raise if not found or `is_active = false`.
3. Parse `template.structure` JSONB.
4. Loop sections in `sort_order`:
   - INSERT `estimate_section` (parent_section_id NULL for top-level).
   - Loop subsections in `sort_order`: INSERT with `parent_section_id` set.
5. Loop items per section/subsection in `sort_order`. For each item, build the line item by **coalescing in this priority order**:
   1. Template override field if set (`description_override`, `quantity_override`, `unit_price_override`).
   2. Library current value if `library_item_id` resolves to an active item in the same org (`description`, `code`, `default_quantity` → `quantity`, `default_unit` → `unit`, `unit_price`).
   3. Placeholder default — `description = '[unknown item]'`, `quantity = 1`, `unit`/`code` = NULL, `unit_price = 0`.

   `library_item_id` on the resulting `estimate_line_items` row is the resolved id if the lookup succeeded, otherwise NULL.

   Track broken-ness: if the library lookup failed (not found / inactive / cross-org), append to `broken_refs` with:
   - `placeholder: true` if the line item has NO usable overrides AND the library was broken (i.e., we filled every field from the placeholder default).
   - `placeholder: false` if at least one override field was set (the row has real user-authored data, just missing the library backstop).
6. Apply statements: if `template.opening_statement` is non-null and non-empty, set `estimate.opening_statement = template.opening_statement` (overrides any existing — locked: template wins). Same for closing_statement.
7. Recalculate estimate totals (call existing 67a `recalculateTotals(p_estimate_id)`).
8. UPDATE estimate `updated_at = now()`.
9. RETURN the result jsonb.

The route handler at `src/app/api/estimates/[id]/apply-template/route.ts` maps:
- `estimate_not_found` → 404
- `estimate_not_draft` → 400
- `estimate_not_empty` → 400 ("Apply Template requires a zero-section estimate")
- `template_not_found_or_inactive` → 404
- success → 200 with the result jsonb passed through

### 5.3 CHECK constraint: void-when-converted guard

```sql
ALTER TABLE estimates
  ADD CONSTRAINT estimates_no_void_when_converted
  CHECK (NOT (status = 'voided' AND converted_to_invoice_id IS NOT NULL));
```

Defense-in-depth backstopping the API-level "cannot void a converted estimate" rule. Catches direct DB updates that bypass the API.

## 6. Server utilities

### New files

- **`src/lib/estimate-templates.ts`** — `listTemplates(filters)`, `getTemplate(id)`, `getTemplateWithContents(id)`, `createTemplate`, `updateTemplate`, `deactivateTemplate`, `reactivateTemplate`. Plus `serializeStructureFromBuilder(template) → jsonb` (writes `template.structure` from in-memory sections + items + subsections + library_item_ids + override fields). Plus `applyTemplate(estimateId, templateId)` (thin RPC wrapper with error mapping).
- **`src/lib/invoices.ts`** — replaces today's `src/lib/invoices/types.ts` with the full surface mirroring `src/lib/estimates.ts`: `InvoiceWithContents` type, `createInvoice(jobId, body)`, `getInvoiceWithContents(id)`, `updateInvoice(id, body, snapshot)`, `voidInvoice(id, reason)`, `markInvoiceSent(id)`, `markInvoicePaid(id, amount)`, `recalculateInvoiceTotals(id)`, `generateInvoiceNumber(jobId)` (thin wrapper around the existing 67a RPC).
- **`src/lib/builder-shared.ts`** — `touchEntity(supabase, table, id)`, `checkSnapshot(supabase, table, id, snapshotIso)`, `recalculateMonetary(lineItems, opts)` (pure, no DB), `roundMoney`. Both estimate and invoice route handlers import from here.
- **`src/lib/conversion.ts`** — `convertEstimateToInvoice(estimateId, supabase) → { newInvoiceId, newInvoiceNumber }`. Thin RPC wrapper with the error-code mapping called out in §5.1.

### Modified files

- **`src/lib/estimates.ts`** — refactor `recalculateTotals` to delegate to `builder-shared.ts`'s pure calc, then UPDATE. `touchEstimate` → re-export from `builder-shared.ts` for back-compat. Public surface unchanged.
- **`src/lib/estimate-status.ts`** — extend with `INVOICE_STATUS_BADGE_CLASSES` map and polymorphic `formatStatusLabel(kind, status)`. Existing single-arg `formatStatusLabel(status)` kept as `formatEstimateStatusLabel` (renamed; callers updated) — or kept as a thin wrapper if rename is too noisy.
- **`src/lib/types.ts`** — add `InvoiceWithContents`, `TemplateWithContents`, `EstimateTemplate`, `BuilderEntity` discriminated union, `AutoSaveConfig<T>`.

### Deleted files

- **`src/lib/invoices/types.ts`** — superseded by `src/lib/invoices.ts`. The exports (`InvoiceStatus`, `InvoiceLineItemInput`, `InvoiceLineItemRow`, `InvoiceWithItems`, `roundMoney`, `computeTotals`) all migrate or get replaced. Search for callers and update imports.

### Kept untouched

- **`src/lib/invoices/generate-invoice-pdf.tsx`** — only because [src/components/invoices/invoice-pdf-document.tsx](src/components/invoices/invoice-pdf-document.tsx) imports it. Not modified in 67b. 67c rewrites both. Audit during implementation per §12 in case the rest of the kept-PDF-route chain breaks against the new schema.

## 7. API routes

| Path | Methods | Permission | Notes |
|---|---|---|---|
| `estimate-templates/route.ts` | GET, POST | GET: `view_estimates`, POST: `manage_templates` | List supports `?search=&damage_type=&is_active=` |
| `estimate-templates/[id]/route.ts` | GET, PUT, DELETE | GET: `view_estimates`, PUT/DELETE: `manage_templates` | DELETE = soft (sets `is_active = false`) |
| `estimate-templates/[id]/sections/route.ts` | POST, PUT (reorder) | `manage_templates` | Same shape as estimates |
| `estimate-templates/[id]/sections/[section_id]/route.ts` | PUT, DELETE | `manage_templates` | |
| `estimate-templates/[id]/line-items/route.ts` | POST, PUT (reorder) | `manage_templates` | No `recalculateTotals` call (templates have no totals) |
| `estimate-templates/[id]/line-items/[item_id]/route.ts` | PUT, DELETE | `manage_templates` | |
| `estimate-templates/[id]/serialize/route.ts` | POST | `manage_templates` | Materializes the live builder state into `structure` JSONB. Called on Save Template button click. |
| `estimates/[id]/apply-template/route.ts` | POST | `edit_estimates` | Body: `{ template_id }`. Calls RPC. Returns broken_refs report. |
| `estimates/[id]/convert/route.ts` | POST | `convert_estimates` | Calls RPC. Returns `{ new_invoice_id, new_invoice_number }` or 409 with `{ existing_invoice_id, existing_invoice_number }`. |
| `estimates/[id]/status/route.ts` | PUT | `edit_estimates` | Body: `{ status: 'sent' \| 'approved' \| 'rejected', updated_at_snapshot }`. Validates current → next transition. 409 on stale snapshot. |
| `invoices/route.ts` (REWRITE) | GET, POST | GET: `view_invoices`, POST: `create_invoices` | POST creates draft invoice; same shape as estimates POST |
| `invoices/[id]/route.ts` (REWRITE GET + PUT) | GET, PUT, DELETE | GET: `view_invoices`, PUT: `edit_invoices`, DELETE: `edit_invoices` (= void) | New schema fields surfaced in GET; PUT body mirrors estimates PUT |
| `invoices/[id]/sections/route.ts` | POST, PUT | `edit_invoices` | Mirrors estimate sections route |
| `invoices/[id]/sections/[section_id]/route.ts` | PUT, DELETE | `edit_invoices` | |
| `invoices/[id]/line-items/route.ts` | POST, PUT | `edit_invoices` | Calls `recalculateInvoiceTotals` |
| `invoices/[id]/line-items/[item_id]/route.ts` | PUT, DELETE | `edit_invoices` | |
| `invoices/[id]/status/route.ts` | PUT | `edit_invoices` | Body: `{ status: 'sent' \| 'paid' \| 'partial', amount?, updated_at_snapshot }` |
| `invoices/[id]/{mark-sent,pdf,send,void}/route.ts` | as-is | as-is | **KEPT untouched.** Read shape audit during implementation (see §12). |

All new routes follow the 67a-cleanup-pass discipline: `lib/api-errors.ts` `apiDbError` for 5xx redaction, `lib/postgrest.ts` `escapeOrFilterValue` for any `.or(...)` with user input, input validation on every POST/PUT body field type.

## 8. Pages + components

### New pages

- `src/app/settings/estimate-templates/page.tsx` — server-rendered shell + client list/grid component.
- `src/app/settings/estimate-templates/[id]/edit/page.tsx` — server-rendered shell; `<EstimateBuilder mode="template" entity={...} />`.
- `src/app/jobs/[id]/invoices/new/page.tsx` — server action: creates draft invoice via `POST /api/invoices`, redirects to `/invoices/[new_id]/edit`.
- `src/app/invoices/[id]/edit/page.tsx` — server-rendered shell; `<EstimateBuilder mode="invoice" entity={...} />`.

### Rewritten pages

- `src/app/invoices/[id]/page.tsx` — read-only invoice view rebuilt for new schema. HeaderBar embeds `<RecordPaymentModal>` and `<PaymentRequestModal>` triggers. "Send" button still hits the existing kept `/send` route. "PDF" still hits the existing kept `/pdf` route.
- `src/app/invoices/page.tsx` — list page updated for new schema columns. Status pill from extended `lib/estimate-status.ts`.

### Deleted pages

- `src/app/invoices/new/page.tsx` — orphaned by `/jobs/[id]/invoices/new/page.tsx`. Inbound links update to point to job-scoped creation.

### New components

- `src/components/template-applicator/template-banner.tsx` — post-create banner with Combobox dropdown. Damage-type-matching templates pinned to top.
- `src/components/template-applicator/broken-refs-banner.tsx` — dismissible persistent banner; expand-inline list of affected line items with section path and click-to-scroll.
- `src/components/job-detail/invoices-list.tsx` — Invoices half of `EstimatesInvoicesSection`.
- `src/components/conversion/convert-confirm-modal.tsx`.
- `src/components/estimate-builder/template-meta-bar.tsx` — replaces the customer block + metadata bar in template mode. Renders template name (inline editable) + damage-type tag picker only.

### Modified components — the 11 builder files get `mode` prop wiring

- `src/components/estimate-builder/estimate-builder.tsx` — accepts `BuilderEntity`; switches metadata + customer + statements + totals visibility per kind; routes auto-save via mode-specific `AutoSaveConfig`.
- `src/components/estimate-builder/header-bar.tsx` — mode-aware action button rendering using the matrix in §4.1.
- `src/components/estimate-builder/metadata-bar.tsx` — renders `Issued / Valid Until` (estimate) OR `Issued / Due / PO Number` (invoice) OR delegates to `template-meta-bar.tsx` (template).
- `src/components/estimate-builder/customer-block.tsx` — hidden in template mode.
- `src/components/estimate-builder/statement-editor.tsx` — placeholder text varies by mode.
- `src/components/estimate-builder/section-card.tsx` + `subsection-card.tsx` + `line-item-row.tsx` + `add-item-dialog.tsx` — accept `entityKind` to wire correct API URLs; otherwise visually identical across modes.
- `src/components/estimate-builder/totals-panel.tsx` — hidden in template mode.
- `src/components/estimate-builder/save-indicator.tsx` — unchanged.
- `src/components/estimate-builder/use-auto-save.ts` — generic-ified per §4.3.

### Modified components — outside builder

- `src/components/job-detail/estimates-invoices-section.tsx` — extends to include invoices-list + linkage display per §9.4.
- `src/components/nav.tsx` — adds "Estimate Templates" link under existing Catalog group (next to Item Library).
- `src/components/invoices/invoice-status-pill.tsx` — swaps internal implementation to call `formatStatusLabel('invoice', status)` from extended `lib/estimate-status.ts`. File kept to avoid noisy delete-and-recreate.

### Deleted components

- `src/components/invoices/invoice-new-client.tsx` — replaced by builder `mode="invoice"` rendering on `/invoices/[id]/edit/page.tsx`.
- `src/components/invoices/line-items-editor.tsx` — superseded.
- `src/components/invoices/invoice-totals-panel.tsx` — superseded by `estimate-builder/totals-panel.tsx`.
- `src/components/invoices/invoice-detail-client.tsx` — replaced by a thinner read-only-invoice client + payment-button island in the rewritten `/invoices/[id]/page.tsx`.

### Kept untouched

- `src/components/invoices/invoice-pdf-document.tsx` — 67c will rewrite. Read-shape audit during implementation: confirm it works against new-schema invoices (most fields it reads are unchanged: `invoice_number`, `total_amount`, `tax_rate`, `subtotal`, `tax_amount`, line items' `description`/`quantity`/`unit_price`/`amount`/`xactimate_code`). If a field has been removed or repurposed, freeze the route behind a 503 + "PDF generation rebuilt in 67c" until 67c lands.
- `src/components/payments/{payment-request-modal,record-payment-modal}.tsx` — consumed by the new read-only invoice view's HeaderBar.
- `src/components/compose-email.tsx` — used by the existing `/send` route flow, kept.

## 9. UI behavior

### 9.1 Status workflows

**Estimate state machine:**

```
draft ──Mark as Sent──▶ sent ──Mark Approved──▶ approved ──Convert──▶ converted (terminal)
                          │
                          └──Mark Rejected──▶ rejected (terminal)

any state except converted ──Void──▶ voided
```

**Invoice state machine:**

```
draft ──Mark as Sent──▶ sent ──Record Payment (full)──▶ paid (terminal)
                          │           │
                          │           └──Record Payment (partial)──▶ partial ──Record Payment (rest)──▶ paid
                          │
any state except paid ──Void──▶ voided
```

Send Payment Request (Stripe) is available in `draft` / `sent` / `partial` and does not change status.

The `/api/{estimates,invoices}/[id]/status/route.ts` endpoints validate `current → next` transitions server-side. UI hides buttons for invalid transitions; API rejects with 400 if forced. Both use the `updated_at_snapshot` 409 dance (consistent with the rest of the auto-save concurrency model).

### 9.2 Apply Template UX

Banner appears below MetadataBar on empty estimates only (`sections.length === 0` AND no localStorage applied flag for this estimate id):

> 📋 **Start from a template?** &nbsp; [Search templates ▼] &nbsp; *or click "+ New Section" to start blank.*

The Combobox dropdown lists **active** templates with damage-type-matching entries pinned to top (uses `estimate.job.damage_type` to match against `template.damage_type_tags`). Each entry shows: name, damage-type pills, "N sections" count.

On selection → `POST /api/estimates/[id]/apply-template` with `{ template_id }`. RPC populates atomically. Response: `{ section_count, line_item_count, broken_refs: [...] }`.

**Always:** toast `"Template applied — {section_count} sections, {line_item_count} items added."`

**Always:** set `localStorage["nookleus.template-applied.${estimateId}"] = '1'` to hide the banner permanently for this estimate (covers the statements-only case).

**If `broken_refs.length > 0`:** in addition, a dismissible persistent banner appears below MetadataBar:

> ⚠ **{N} items reference inactive library entries.** Edit them or replace before sending. &nbsp; [Show items ▾] &nbsp; [Dismiss]

"Show items" expands inline listing the affected line items with their section path ("Section 1 → Initial Response → [unknown item]"). Clicking a row scrolls to that line item in the builder.

Dismiss persists in `localStorage["nookleus.broken-refs-dismissed.${estimateId}"]`. Dismissing on one estimate doesn't affect others.

### 9.3 Conversion UX

"Convert to Invoice" button enabled only on `status='approved'` estimates. Click → modal (`<ConvertConfirmModal>`):

> **Convert this estimate to an invoice?**
>
> - Creates new invoice **{job_number}-INV-{seq}**
> - Copies sections, line items, markup, discount, tax, and statements
> - Marks this estimate as **Converted** (read-only)
> - Redirects you to the new invoice (still editable)
>
> [Cancel] &nbsp; [**Convert to Invoice**]

POST `/api/estimates/[id]/convert` → RPC → response `{ new_invoice_id, new_invoice_number }` → redirect to `/invoices/{new_invoice_id}/edit`.

**Already-converted retry guard:** if user clicks Convert twice (double-tap, browser back+forward, server retry), API returns `409` with `{ existing_invoice_id, existing_invoice_number }`. Modal swaps to:

> ⚠ **This estimate has already been converted to {INV-N}.**
>
> [Go to invoice →] &nbsp; [Cancel]

### 9.4 Job-detail integration

`<EstimatesInvoicesSection>` extended layout:

```
┌─ Estimates & Invoices ──────────────────────────────┐
│  Estimates                          [+ New Estimate] │
│  ┌────────────────────────────────────────────────┐ │
│  │ EST-1  Title  [draft]      $1,234.56  Apr 30   │ │
│  │ EST-2  Title  [converted → INV-1]  $987.00     │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Invoices                            [+ New Invoice] │
│  ┌────────────────────────────────────────────────┐ │
│  │ INV-1  Title  [sent] (← EST-2)  $987.00        │ │
│  │ INV-2  Title  [paid]            $543.00        │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

Per-row linkage badge inline: estimates show `→ INV-N` (link to `/invoices/[id]`) when `converted_to_invoice_id` is set; invoices show `← EST-M` (link to `/estimates/[id]`) when `converted_from_estimate_id` is set.

Action menus per row:
- **Estimate:** View / Edit / *Convert to Invoice* (if approved AND not yet converted) / Duplicate / Void.
- **Invoice:** View / Edit / Send Payment Request (if not voided/paid) / Mark as Paid (if sent/partial) / Duplicate / Void.

Buttons gate on permissions exactly like the builder HeaderBar.

"Duplicate" on either side opens a confirm modal then POSTs to a new `/api/{estimates|invoices}/[id]/duplicate/route.ts` — but **duplicate is out of scope for 67b** (it's mentioned in the build guide's row action menu but not in 7.1 Deliverables). Render the menu item disabled with "Coming soon" tooltip in 67b; ship the routes in 67c+.

### 9.5 Existing invoice list page (`/invoices`)

Updated columns: invoice number (mono), title, job (linked), status pill, total ($), issued date, due date, action menu (View / Edit / Void). Filter: status, job, date-range, search. Status pill uses `formatStatusLabel('invoice', status)`.

Existing pre-67a invoices in the DB at the time of 67b ship: there are none (test row was deleted pre-67a migration). The page's empty state from the existing implementation carries through.

### 9.6 Templates list page (`/settings/estimate-templates`)

Card grid:

```
┌─ Standard Water Mitigation ───────────┐
│ [water] [flood]                        │
│ 4 sections · 18 items                  │
│ Edited 2 days ago                      │
│ [Edit] [Duplicate] [Deactivate]        │
└────────────────────────────────────────┘
```

Filter: damage type, active/inactive. "+ New Template" header button → creates an empty template draft via `POST /api/estimate-templates` and redirects to `/settings/estimate-templates/[new_id]/edit` (mirrors the estimate-create pattern).

Inactive templates render with reduced opacity + "Inactive" pill; "Reactivate" replaces "Deactivate" in the action set.

Duplicate is **disabled with "Coming soon" tooltip** in 67b (same as job-detail rows); template duplication is a 67c+ chip.

## 10. Edge cases

| Case | Behavior |
|---|---|
| Apply template to non-empty estimate | API 400 ("estimate must have zero sections"); UI banner already hidden when sections > 0 |
| Apply template that has zero sections (statements-only) | RPC succeeds; sets statements only; toast `"Template applied — opening + closing statements added"`; localStorage flag set so banner hides |
| Apply template referencing deleted library_item_id with `*_override` set | RPC uses overrides; line item created; counted in `broken_refs` with `placeholder: false` |
| Apply template referencing deleted library_item_id with no overrides | RPC creates placeholder line item (`description = '[unknown item]'`, qty 1, unit_price 0); counted in `broken_refs` with `placeholder: true` |
| Apply template fills statements when estimate already has statements | **Locked: template wins.** Build guide says "fill from template if template has them set." Builds the assumption that user wouldn't apply a template if they'd already written custom statements. |
| Convert non-approved estimate via direct API call | RPC raises `estimate_not_approved`; route returns 400 |
| Convert approved estimate concurrently from two tabs | Second `FOR UPDATE` waits; checks `converted_to_invoice_id IS NULL`; second one fails with `estimate_already_converted:<uuid>`; route returns 409 + existing invoice id |
| Void converted estimate via UI | Button hidden when status = 'converted' |
| Void converted estimate via direct API call | API returns 400 ("Cannot void a converted estimate. Void the linked invoice instead.") |
| Void converted estimate via direct DB UPDATE | CHECK constraint `estimates_no_void_when_converted` raises |
| Void invoice that was converted from an estimate | Allowed; estimate stays `converted` (does NOT un-convert) |
| Mark as Sent on already-sent estimate | API 400 ("already sent"); UI hides button when status ≠ 'draft' |
| Mark Approved on draft estimate (skipping sent) | API 400 ("must be sent first"); UI hides button |
| Mark Approved on rejected estimate | API 400; UI hides button (rejected is terminal) |
| Auto-save during conversion in-flight | The Convert button sets `staleConflictRef` after success → auto-save short-circuits → redirect happens → next mount resets state |
| Auto-save during template apply in-flight | Apply Template disables itself for the in-flight duration; auto-save no-ops on the empty estimate (no sections to save) |
| Invoice editor opened with `converted_from_estimate_id` set | "From estimate {EST-M}" pill shown in MetadataBar with link to the read-only estimate page |
| Template editor: drag a subsection between parent sections | Disallowed (same constraint as estimate builder) |
| Template editor: line items dragged across sections | Disallowed |
| Template's "Save Template" button | Calls `POST /api/estimate-templates/[id]/serialize` to materialize live builder state into `structure` JSONB. Auto-save covers field-level edits; serialize is the explicit "make this the reference structure" action. |
| Template applied to estimate after the template has since been deleted | Apply UI lists active templates only; cross-tab race falls through to RPC's `template_not_found_or_inactive` → 404 |
| Library item used by both estimate AND template, then deactivated | Estimate retains snapshot (already locked in 67a). Template stores `library_item_id` + `*_override` fields in `structure` JSONB; subsequent applies fall through to broken-ref handling |
| Existing `/api/invoices/[id]/pdf` route invoked against new-schema invoice | Audit during implementation (§12). If works → ship as-is. If crashes → 503 freeze until 67c lands. |
| Invoice editor saved without `due_date` | Allowed (column nullable). UI shows it as optional. |
| Invoice with markup/discount/tax = 0 | Allowed; subtotal == adjusted_subtotal == total_amount (minus tax = 0) |
| Invoice converted from estimate, edited later | Expected and correct — invoice is a snapshot at conversion time; subsequent edits are the user's |
| 409 stale-snapshot during Mark as Sent / Mark Approved / Mark Rejected | Status PUT route reads `updated_at_snapshot` from body; if stale, returns 409; UI shows the same toast "Modified by another user — refresh" used in the builder |
| User clicks Save Template button while auto-save is in-flight | Wait-for-in-flight pattern: serialize call is queued behind the in-flight save; ensures structure JSONB reflects the absolute-latest state |
| Apply Template's localStorage flag persists across browsers | Per-browser. Worst case: a user applies on browser A, banner shows again on browser B for the same estimate. Banner click does nothing if sections > 0; safe. |
| Apply Template UX on a draft estimate created weeks ago | Banner shows again unless localStorage flag is set; same UX. Acceptable. |

## 11. Manual test plan

After `npm run build` is clean, `migration-build67b-conversion-and-template-apply.sql` is applied, and the manual `§11` happy-path test for 67a is also done (still owed):

1. **Templates CRUD.** Create template via builder (template mode); edit name + damage tags + statements + sections + items; click Save Template; reload page; verify `structure` JSONB persisted. Deactivate; verify hidden from Apply Template dropdown. Reactivate.
2. **Apply template (clean path).** Create empty estimate on a job. Banner shows. Pick a template with damage-type matching the job. Verify sections + items + statements populate; banner disappears; toast fires.
3. **Apply template (broken refs).** Deactivate a library item used by a template. Apply that template. Verify toast + persistent banner + "Show items" expand with affected line items shown by section path. Dismiss banner; reload page; verify dismiss persisted (localStorage).
4. **Apply template (statements only).** Apply a template that has zero sections but has opening + closing statements. Verify both statements fill in; no sections added; banner hides via localStorage flag.
5. **Estimate status workflow.** Draft → Mark as Sent → Mark Approved → Convert. Verify each transition via UI button; then verify direct API calls respect transitions (skipping sent → 400, etc.).
6. **Convert flow (clean).** Approved estimate → click Convert → modal → confirm → redirected to invoice editor. Verify content: sections, items, markup, discount, tax all match. Verify estimate is now Converted (read-only) with link to new invoice. Verify new invoice has "From {EST-M}" pill.
7. **Convert flow (already-converted).** Hit `/convert` API again on a converted estimate; verify 409 + linked invoice id. Click Convert from UI on a Converted estimate; verify modal swaps to "already converted" message with link.
8. **Void rules.** Void converted estimate via UI: button hidden. Void via direct API: 400. Void invoice that was from an estimate: allowed; estimate stays Converted. Void converted estimate via direct DB UPDATE: CHECK constraint raises.
9. **Invoice creation from scratch.** "+ New Invoice" on a job → creates draft → loads in builder (invoice mode). Add sections, items. Verify INV-N number and new schema columns populated. Verify auto-save (estimate-level PUT, sections reorder, line-item edits).
10. **Invoice numbering.** Convert two estimates → INV-1 then INV-2. Create invoice from scratch on the same job → INV-3. Create invoice from scratch on a different job → INV-1.
11. **Read-only invoice view.** Open `/invoices/[id]` for a sent invoice. Verify Payment Request modal opens (Stripe). Verify Record Payment modal opens. Click Send → existing email send flow runs (kept route). Click PDF → existing PDF route runs (kept route, audited).
12. **Invoices list page.** `/invoices` shows all invoices org-wide with new schema columns. Filter by status. Sort.
13. **Permissions.** Crew Lead (no `manage_templates`) cannot reach `/settings/estimate-templates`; can convert if has `convert_estimates`. Crew Member (view-only) cannot do any state transitions; sees View only in row action menus.
14. **Cross-org RLS.** AAA logged in; direct API call to apply a TestCo template_id to an AAA estimate → RPC raises "template not found"; route returns 404.
15. **Builder mode-prop regressions.** Open an existing 67a-era estimate; verify it still loads and saves identically to pre-67b behavior (no regressions from the `mode` prop refactor).

## 12. Out-of-band tasks

- **Pre-implementation audit:** confirm `src/components/invoices/invoice-pdf-document.tsx` and `/api/invoices/[id]/pdf/route.ts` work against new-schema invoices (no writes to broken NULL columns; reads existing fields). If yes, ship as-is. If not, freeze behind 503 + "PDF generation rebuilt in 67c" until 67c lands. **Decide first task in implementation.**
- **Pre-implementation audit:** confirm `/api/invoices/[id]/{send,mark-sent,void}/route.ts` work against new-schema invoices. Same disposition.
- **Pre-implementation sweep:** find all callers of `src/lib/invoices/types.ts` (`InvoiceStatus`, `InvoiceWithItems`, `InvoiceLineItemRow`, `roundMoney`, `computeTotals`) and update imports to `src/lib/invoices.ts` or `src/lib/builder-shared.ts`.
- **Post-migration smoke test:** verify `migration-build67b` applies cleanly; both RPCs callable from the SQL editor; CHECK constraint raises on void-when-converted attempt.

## 13. Carry-over to 67c

- **PDF preset manager UI** at `/settings/pdf-presets` (schema already in 67a — `pdf_presets` table + partial unique index on `(organization_id, document_type) WHERE is_default = true`).
- **PDF generation rewrite** for both estimates and invoices using the new schema (sections, statements, markup/discount/adjusted_subtotal). Replaces 67b-era kept `/api/invoices/[id]/pdf` route.
- **"Send via Email"** button on both estimate and invoice (separate from Mark as Sent). Estimate gets new `/api/estimates/[id]/send`. Invoice gets the existing `/api/invoices/[id]/send` rewritten for new schema.
- **Duplicate** action on estimates, invoices, and templates (currently disabled with "Coming soon" tooltip in 67b).
- **5xx error redactor sweep across the remaining ~80 routes** (separately tracked chip).
- **Customer-facing approval magic links** — open question, deferred indefinitely.

## 14. Open questions

None blocking. The §10 edge-cases table covers the corner-cases surfaced during brainstorm. If new ones surface during implementation, raise them per Rule C (stop on material finding) — the discipline established in [[2026-04-30-build-14j]].

## 15. Build label rationale

67a / 67b / 67c was set in 67a's design doc. 67b is the canonical "templates + conversion + invoice editor" sub-build per the build guide section 7.

## 16. Authorship trail

- Build guide: `~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md` (sections 5.2, 5.4, 5.7, 7).
- 67a design doc: `docs/superpowers/specs/2026-04-30-build-67a-estimates-foundation-design.md`.
- 67a cleanup-session "Notes for next session": `docs/vault/handoffs/2026-05-01-build-67a-2.md` — flagged auto-save generic-ification, references-pre-flight requirement, status-badge dedup pattern.
- This brainstorm session: 2026-05-01, single session, decisions locked in batch.
