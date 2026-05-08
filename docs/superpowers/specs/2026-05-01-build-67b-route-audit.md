# Kept invoice routes — pre-67b schema audit (2026-05-01)

Routes kept from pre-67a (not replaced by 67b's new invoice editor):
`mark-sent`, `pdf`, `send`, `void`

Schema snapshot used: live DB queried via Supabase MCP on 2026-05-01.

---

## /api/invoices/[id]/mark-sent

**Operation:** POST — status flip only, no line-item access.

- Reads from `invoices`: `status`
- Writes to `invoices`: `status` (→ `"sent"`), `sent_at`
- Touches `invoice_line_items`: none

**Column check:**

| Column | Present post-67a? | Nullable? |
|--------|-------------------|-----------|
| `status` | YES | NO |
| `sent_at` | YES | YES |

Both columns exist and have correct nullability for the operation (writing a non-null
`sent_at` into a nullable column is fine). The route never touches `title` or
`sequence_number` (the 67a NOT NULL additions), so those constraints are irrelevant here.

**Verdict:** PASS — ships untouched.

---

## /api/invoices/[id]/pdf

**Operation:** GET — reads full invoice + all line items, generates PDF. No writes to
`invoices` or `invoice_line_items`.

- Reads from `invoices`: `*` (via `select("*")` cast to `InvoiceWithItems`)
  - Columns actually consumed by `InvoicePdfDocument`:
    `invoice_number`, `issued_date`, `due_date`, `po_number`,
    `subtotal`, `tax_amount`, `tax_rate`, `total_amount`, `memo`
- Reads from `invoice_line_items`: `*` (via `select("*")`)
  - Columns actually consumed by renderer: `id`, `xactimate_code`,
    `description`, `quantity`, `unit_price`, `amount`, `sort_order`
- Also reads `jobs` and `contacts` for customer block (separate tables, unaffected by 67a).
- Writes (mode=attachment only): Supabase Storage — no DB row writes.

**Column check — `invoices`:**

All nine invoice columns consumed by the renderer are present post-67a. The `select("*")`
also returns the new 67a columns (`title`, `sequence_number`, `markup_*`, `discount_*`,
`adjusted_subtotal`, `opening_statement`, `closing_statement`, `converted_from_estimate_id`,
`void_reason`, `created_by`) — these are ignored by both `InvoiceWithItems` (typed against
the pre-67a `InvoiceRow` interface) and the PDF renderer. Extra columns from `select("*")`
are harmless in TypeScript at runtime since the renderer only destructures the fields it
needs; TypeScript type-checks use the interface, not the DB shape, so no compile error.

**Column check — `invoice_line_items`:**

All seven line-item columns consumed by the renderer are present post-67a. The `select("*")`
also returns `section_id`, `library_item_id`, `unit`, `organization_id` — ignored by renderer.

**Important type-gap note (non-blocking):** `InvoiceRow` (and therefore `InvoiceWithItems`)
does not declare the 67a-added fields (`title`, `sequence_number`, `markup_type`, etc.).
This means TypeScript sees those columns as absent from the inferred type, but at runtime
they are returned in the row and silently ignored. No route or renderer breaks from this.
The type gap is a hygiene issue for Task 30 to clean up when `InvoiceRow` is updated.

**Verdict:** PASS — ships untouched. (Type gap noted but non-breaking at runtime.)

---

## /api/invoices/[id]/send

**Operation:** POST — identical DB shape to `mark-sent`.

- Reads from `invoices`: `status`
- Writes to `invoices`: `status` (→ `"sent"`), `sent_at`
- Touches `invoice_line_items`: none

**Column check:**

| Column | Present post-67a? | Nullable? |
|--------|-------------------|-----------|
| `status` | YES | NO |
| `sent_at` | YES | YES |

No contact with `title` or `sequence_number`.

**Verdict:** PASS — ships untouched.

---

## /api/invoices/[id]/void

**Operation:** POST — status flip + audit fields. Also reads `payments` (separate table).

- Reads from `invoices`: `status`
- Writes to `invoices`: `status` (→ `"voided"`), `voided_at`, `voided_by`
- Reads from `payments`: `id` (count only)
- Touches `invoice_line_items`: none

**Column check:**

| Column | Present post-67a? | Nullable? |
|--------|-------------------|-----------|
| `status` | YES | NO |
| `voided_at` | YES | YES |
| `voided_by` | YES | YES |

`voided_by` is populated from `user.id` (a UUID from the auth session), which matches
the column's `uuid` data type and nullable constraint (writing non-null into nullable = fine).
No contact with `title` or `sequence_number`.

**Verdict:** PASS — ships untouched.

---

## Decision summary

| Route | Verdict | 67b disposition |
|-------|---------|-----------------|
| `mark-sent` | PASS | Keep as-is; no Task 30 action needed |
| `pdf` | PASS | Keep as-is; **Task 30 note:** update `InvoiceRow` / `InvoiceWithItems` types to include 67a columns so `select("*")` cast is accurate |
| `send` | PASS | Keep as-is; no Task 30 action needed |
| `void` | PASS | Keep as-is; no Task 30 action needed |

**All four routes pass.** None require a 503 freeze. The only follow-up item is a
type-hygiene update to `InvoiceRow` / `InvoiceLineItemRow` in
`src/lib/invoices/types.ts` to reflect the 67a-added columns — this is bookkeeping
for Task 30 and does not affect runtime behaviour of any kept route.

---

## Final dispositions (post-67b implementation, pre-ship)

- mark-sent: PASS — ships untouched.
- void: PASS — ships untouched (CHECK constraint backstops; route has its own already-voided guard at line 26).
- send: PASS — ships untouched. PDF visual fidelity degrades for 67b-era invoices with markup/discount; spec'd as 67c rewrite.
- pdf: PASS — ships untouched. Same caveat as send.

No freezing required. All four kept routes work against the new schema.
