# Build 67b Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 67b carry-over chips (C1–C7, I2, I4, two session-8 minors, V1 closeout) so 67b can be declared fully shipped, mirroring the 67a Session 5 precedent.

**Architecture:** 5 focused commits, grouped by review burden:
1. Quick wins (C1 + C7) — bounded one-line + column-restore.
2. Invoice-mode drag-reorder (C2) — replicate estimate branch with HTTP persistence.
3. Polymorphism refactor (C3 + C4 + C5 + C6) — widen TotalsPanel / SectionCard / SubsectionCard / LineItemRow / change-callbacks to accept either entity kind, removing the `as any` casts and the brief invoice totals flash.
4. Migration RPC cleanups (I4 + I2 + minors M3/M4/M6/M7/M8) — new migration `supabase/migration-build67b-cleanup.sql` with `CREATE OR REPLACE FUNCTION` for both RPCs.
5. Session-8 minors + V1 doc closeout (HeaderBar redundant disabled; AddItemDialog template `organization_id: ""` sentinel; mark V1 + all chips resolved).

**Tech Stack:** Next.js 15.5 App Router, TypeScript, React 19, Supabase + Postgres, dnd-kit, Tiptap. No test framework — verification = `npx tsc --noEmit` + manual preview.

**Verification convention** (codebase has no jest/vitest/playwright per CLAUDE.md memory):
- After every code change: run `npx tsc --noEmit` from repo root, expect 0 errors.
- After every code change: run `npm run build` at end of each commit's task, expect successful compile.
- Manual preview verification spelled out per task where the change is UI-visible.

**Non-goals:**
- I1 (`xactimate_code` dual-write) — defer per chip Option C; 67c retires the column.
- 67a Item Library Tasks 16–18 nits (separate from 67b).
- 5xx error redactor sweep across remaining ~80 routes (separate chip).

---

## File map

**Modified (code):**
- `src/components/estimate-builder/estimate-builder.tsx` — C2 (handleDragEnd invoice branch), C3 (markup/discount/tax invoice recompute + onLineItemChange/onLineItemAdded/onLineItemDelete invoice recompute), C5 (TotalsPanel call site cleanup), C6 (SectionCard call site cleanup), HeaderBar redundant `isVoided` already inside the parent guard
- `src/components/estimate-builder/totals-panel.tsx` — C5 (accept `BuilderEntity` discriminated union; narrow internally)
- `src/components/estimate-builder/section-card.tsx` — C6 (widen prop types to accept either Estimate- or Invoice-shaped section + items)
- `src/components/estimate-builder/subsection-card.tsx` — C6 (same widening as SectionCard)
- `src/components/estimate-builder/line-item-row.tsx` — C4 + C6 (widen `item` and `onChange` Partial type to accept either kind)
- `src/components/estimate-builder/header-bar.tsx` — Session-8 minor: drop redundant `isVoided` term inside the `est.status !== "voided" && est.status !== "converted"` block
- `src/components/estimate-builder/add-item-dialog.tsx` — Session-8 minor: stop forging `organization_id: ""` in template-mode local items
- `src/app/api/invoices/[id]/line-items/route.ts` — C1 (wrap response in `{ line_item: data }`)
- `src/components/invoices/invoice-list-client.tsx` — C7 (restore Customer + QB columns, conditioned on org QB connection)

**Created (migration):**
- `supabase/migration-build67b-cleanup.sql` — I2 (regex-safe settings cast in `convert_estimate_to_invoice`) + I4 (inline totals recompute in `apply_template_to_estimate`) + minor M-series comment cleanups in both functions

**Modified (docs):**
- `docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md` — strike resolved chips, mark V1 closed, add this plan link
- `docs/vault/00-NOW.md` — flip 67b state from "cleanup not yet run" to "shipped"

**Untouched but referenced:**
- `src/lib/types.ts:580–799` — read-only; `EstimateLineItem`, `InvoiceLineItem`, `EstimateSection`, `InvoiceSection`, `BuilderEntity` already defined
- `src/lib/estimates-calc.ts` — `computeEstimateTotals` and `sumLineItemsFromSections` are already kind-agnostic (read only `subtotal`, `markup_*`, `discount_*`, `tax_rate` and `quantity`/`unit_price`); reused for invoice-mode local recompute by mapping the result's `total → total_amount`

---

## Task 1 — Quick wins (C1 + C7)

**Goal:** Two bounded fixes that are visible to the user and review in seconds.

**Files:**
- Modify: `src/app/api/invoices/[id]/line-items/route.ts:111`
- Modify: `src/components/invoices/invoice-list-client.tsx:111-195`

### Step 1.1 — C1: wrap invoice POST line-items response

- [ ] Open `src/app/api/invoices/[id]/line-items/route.ts`. Locate line 111:

```ts
    return NextResponse.json(data);
```

- [ ] Replace with:

```ts
    return NextResponse.json({ line_item: data });
```

This matches `src/app/api/estimates/[id]/line-items/route.ts:150` (`return NextResponse.json({ line_item: data }, { status: 201 });`). The estimate route also uses `status: 201`; do NOT add `201` here — Eric accepted the 200 in Test 7. Keep the existing 200 (no second arg).

**Why:** AddItemDialog reads `data.line_item` (`add-item-dialog.tsx:185-186`). Invoice mode currently returns the bare row, so the optimistic insert reads `undefined` until the next root PUT settles.

### Step 1.2 — C7: restore Customer + QB columns to invoices list

- [ ] Open `src/components/invoices/invoice-list-client.tsx`. Locate the `<thead>` block at lines ~113-123:

```tsx
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium w-10" />
              </tr>
            </thead>
```

- [ ] Replace with (Customer added after Title, QB added before actions kebab):

```tsx
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="text-left px-4 py-2 font-medium">QB</th>
                <th className="px-4 py-2 font-medium w-10" />
              </tr>
            </thead>
```

- [ ] Locate the `colSpan={8}` empty-state row at line ~128 and bump it to `colSpan={10}`.

- [ ] Locate the `{rows.map((r) => (` block. After the existing `<td className="px-4 py-2">{r.title || "—"}</td>` row, insert the Customer cell BEFORE the Job cell:

```tsx
                  <td className="px-4 py-2">
                    {[r.jobs?.contacts?.first_name, r.jobs?.contacts?.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
```

- [ ] After the existing `<td className="px-4 py-2 text-muted-foreground">{formatDate(r.due_date)}</td>` and BEFORE the actions `<td>` containing the DropdownMenu, insert the QB cell:

```tsx
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.qb_invoice_id ? `QB ${r.qb_invoice_id}` : "—"}
                  </td>
```

The chip says "conditioned on org having QB connected." That requires fetching the org's QB connection state — a heavier change. For this commit, render `—` when null (matches the pre-67b shape from `git show 74173f3^:src/components/invoices/invoice-list-client.tsx`). Org-level conditioning can be a separate small follow-up if Eric wants the column hidden entirely for non-QB orgs.

### Step 1.3 — Verify

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] Manual preview:
  - Navigate to `/invoices`. Confirm the table now shows: Invoice # / Title / Customer / Job / Status / Total / Issued / Due / QB / (kebab).
  - Existing rows render Customer (or `—` if no contact) and `—` in QB.
  - Open an invoice's edit page, add an item via library or custom — the new row appears immediately (C1 verification, no flash of `undefined`).

### Step 1.4 — Commit

- [ ] Stage and commit:

```bash
git add src/app/api/invoices/[id]/line-items/route.ts src/components/invoices/invoice-list-client.tsx
git commit -m "fix(67b): C1 invoice line-items response shape + C7 restore list columns"
```

---

## Task 2 — Invoice-mode drag-reorder (C2)

**Goal:** Section / subsection / line-item drag-reorder works in invoice mode (currently a no-op since Task 33.5).

**Files:**
- Modify: `src/components/estimate-builder/estimate-builder.tsx` — `handleDragEnd` body, currently lines ~1219-1467

### Step 2.1 — Read the current handleDragEnd structure

- [ ] Open `src/components/estimate-builder/estimate-builder.tsx`. The function spans roughly lines 1219-1467:

```
1219: function handleDragEnd(event: DragEndEvent) {
1222:   if (state.entity.kind === "template") {
        // ... 80 lines of template-mode local-state mutation, no HTTP
1295:     return;
1296:   }
1298:   // Invoice-mode drag-reorder is a no-op today (TODO post-67b ...)
1300:   if (state.entity.kind !== "estimate") return;
1301:   const { active, over } = event;
        // ... estimate branch with HTTP saveSectionsReorder/saveLineItemsReorder
1467: }
```

The estimate branch (lines 1300-1467) handles three activeTypes — `section`, `subsection`, `line-item` — each doing local optimistic update + HTTP call via the auto-save helpers + rollback on failure.

The invoice's `useAutoSave` config (estimate-builder.tsx:196-210) already returns `saveSectionsReorder` and `saveLineItemsReorder` bound to invoice URLs (`/api/invoices/[id]/sections`, `/api/invoices/[id]/line-items`), so the existing helpers work for invoice without change.

### Step 2.2 — Replace the no-op invoice early-return with a full invoice branch

- [ ] Locate lines 1298-1300:

```ts
    // Invoice-mode drag-reorder is a no-op today (TODO post-67b: needs polymorphic
    // local-state mutator or estimate↔invoice section-shape adapter).
    if (state.entity.kind !== "estimate") return;
```

- [ ] Replace with an `if (state.entity.kind === "invoice") { ... return; }` block, then the existing `if (state.entity.kind !== "estimate") return;` (defense-in-depth — there's no fourth kind, but matches the existing pattern):

```ts
    if (state.entity.kind === "invoice") {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeType = active.data.current?.type as string | undefined;

      if (activeType === "section") {
        const secs = state.entity.data.sections;
        const oldIdx = secs.findIndex((s) => s.id === active.id);
        const newIdx = secs.findIndex((s) => s.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reorderedSections = arrayMove(secs, oldIdx, newIdx);
        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: reorderedSections },
            },
          };
        });

        const sectionPayload = reorderedSections.flatMap((sec, idx) => [
          { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
          ...sec.subsections.map((sub, subIdx) => ({
            id: sub.id,
            sort_order: subIdx,
            parent_section_id: sec.id,
          })),
        ]);

        void saveSectionsReorder(sectionPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save section order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
        return;
      }

      if (activeType === "subsection") {
        const activeParent = active.data.current?.parentSectionId as string | undefined;
        const overParent = over.data.current?.parentSectionId as string | undefined;
        if (activeParent !== overParent) return;

        const parentSection = state.entity.data.sections.find((s) => s.id === activeParent);
        if (!parentSection) return;
        const subs = parentSection.subsections;
        const oldIdx = subs.findIndex((sub) => sub.id === active.id);
        const newIdx = subs.findIndex((sub) => sub.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reorderedSections = state.entity.data.sections.map((s) => {
          if (s.id !== activeParent) return s;
          return { ...s, subsections: arrayMove(subs, oldIdx, newIdx) };
        });
        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: reorderedSections },
            },
          };
        });

        const sectionPayload = reorderedSections.flatMap((sec, idx) => [
          { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
          ...sec.subsections.map((sub, subIdx) => ({
            id: sub.id,
            sort_order: subIdx,
            parent_section_id: sec.id,
          })),
        ]);

        void saveSectionsReorder(sectionPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save subsection order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
        return;
      }

      if (activeType === "line-item") {
        const activeParentSectionId = active.data.current?.parentSectionId as string | undefined;
        const overParentSectionId = over.data.current?.parentSectionId as string | undefined;
        if (activeParentSectionId !== overParentSectionId) return;

        let reorderedItems: import("@/lib/types").InvoiceLineItem[] = [];
        const reorderedSections = state.entity.data.sections.map((s) => {
          if (s.id === activeParentSectionId) {
            const items = s.items;
            const oldIdx = items.findIndex((i) => i.id === active.id);
            const newIdx = items.findIndex((i) => i.id === over.id);
            if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return s;
            reorderedItems = arrayMove(items, oldIdx, newIdx);
            return { ...s, items: reorderedItems };
          }
          return {
            ...s,
            subsections: s.subsections.map((sub) => {
              if (sub.id !== activeParentSectionId) return sub;
              const items = sub.items;
              const oldIdx = items.findIndex((i) => i.id === active.id);
              const newIdx = items.findIndex((i) => i.id === over.id);
              if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return sub;
              reorderedItems = arrayMove(items, oldIdx, newIdx);
              return { ...sub, items: reorderedItems };
            }),
          };
        });

        if (reorderedItems.length === 0) return;

        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: reorderedSections },
            },
          };
        });

        // Invoice line-items reorder API expects `section_id: string` (not nullable)
        // — InvoiceLineItem.section_id is `string | null` in TS but the route validates
        // string (route.ts:118-122). Filter the null case defensively, though the
        // builder UI never produces orphan items.
        const itemPayload = reorderedItems
          .filter((item): item is typeof item & { section_id: string } => item.section_id !== null)
          .map((item, idx) => ({
            id: item.id,
            section_id: item.section_id,
            sort_order: idx,
          }));

        void saveLineItemsReorder(itemPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save line item order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
      }
      return;
    }

    if (state.entity.kind !== "estimate") return;
```

The block is structurally a copy of the estimate branch with `"estimate"` → `"invoice"` in the narrowing checks and `EstimateLineItem` → `InvoiceLineItem` in the type annotation. The HTTP helpers from `useAutoSave` are already invoice-bound via the autoSaveConfig branch (lines 196-210).

### Step 2.3 — Verify

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] Run:

```bash
npm run build
```

Expected: ✓ Compiled successfully.

- [ ] Manual preview verification — open an invoice editor with at least 2 sections, each with 2 subsections and 2 line items:
  1. Drag a top-level section above another. After the drop, the section stays in the new position (does not snap back). Reload the page → order persists.
  2. Drag a subsection within the same parent section. Drop. Stays. Reload → persists.
  3. Drag a line item within the same section. Drop. Stays. Reload → persists.
  4. Drag a line item from one section to another. Drop → snaps back (cross-section disallowed by design, matches estimate behavior).
  5. (Concurrency) Open the same invoice in two tabs, reorder in tab 1, then reorder in tab 2 → tab 2 toasts "Failed to save section order" with a 409 (snapshot guard from `checkSnapshot` in the route).

### Step 2.4 — Commit

- [ ] Stage and commit:

```bash
git add src/components/estimate-builder/estimate-builder.tsx
git commit -m "fix(67b): C2 invoice-mode drag-reorder via HTTP saveSectionsReorder/saveLineItemsReorder"
```

---

## Task 3 — Polymorphism refactor (C3 + C4 + C5 + C6)

**Goal:** Eliminate the `as any` / `as unknown as Estimate` casts at the SectionCard / TotalsPanel / onLineItemChange / onLineItemAdded sites by widening their types. Also add invoice-mode local recompute (C3) so the totals panel updates instantly instead of waiting for the auto-save round-trip.

This is the most type-judgment-heavy commit; expect to revisit specific narrowings.

**Files:**
- Modify: `src/components/estimate-builder/totals-panel.tsx` (C5)
- Modify: `src/components/estimate-builder/section-card.tsx` (C6)
- Modify: `src/components/estimate-builder/subsection-card.tsx` (C6)
- Modify: `src/components/estimate-builder/line-item-row.tsx` (C4 + C6)
- Modify: `src/components/estimate-builder/estimate-builder.tsx` (C3 invoice recompute + remove call-site casts)

### Step 3.1 — TotalsPanel: accept BuilderEntity (C5)

- [ ] Open `src/components/estimate-builder/totals-panel.tsx`. Locate the `TotalsPanelProps` interface at lines 13-20:

```tsx
interface TotalsPanelProps {
  estimate: Estimate;
  onMarkupChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
  mode?: BuilderMode;
}
```

- [ ] Replace with a `BuilderEntity`-shaped prop (template branch is unrendered — early returns `null` at line 149):

```tsx
import type { AdjustmentType, BuilderEntity, BuilderMode } from "@/lib/types";

interface TotalsPanelProps {
  entity: BuilderEntity;
  onMarkupChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
  mode?: BuilderMode;
}
```

(Drop the `Estimate` import from `@/lib/types` if it becomes unused; keep `BuilderMode`.)

- [ ] In the function body (starting line 139), replace destructured `estimate` with `entity` and derive a normalized `totals` object:

```tsx
export function TotalsPanel({
  entity,
  onMarkupChange,
  onDiscountChange,
  onTaxRateChange,
  readOnly = false,
  mode = "estimate",
}: TotalsPanelProps) {
  if (mode === "template" || entity.kind === "template") return null;

  // Narrow on entity.kind to read total vs total_amount; other fields share names.
  const totals = entity.kind === "invoice"
    ? {
        subtotal: entity.data.subtotal,
        markup_type: entity.data.markup_type,
        markup_value: entity.data.markup_value,
        markup_amount: entity.data.markup_amount,
        discount_type: entity.data.discount_type,
        discount_value: entity.data.discount_value,
        discount_amount: entity.data.discount_amount,
        adjusted_subtotal: entity.data.adjusted_subtotal,
        tax_rate: entity.data.tax_rate,
        tax_amount: entity.data.tax_amount,
        total: entity.data.total_amount,
      }
    : {
        subtotal: entity.data.subtotal,
        markup_type: entity.data.markup_type,
        markup_value: entity.data.markup_value,
        markup_amount: entity.data.markup_amount,
        discount_type: entity.data.discount_type,
        discount_value: entity.data.discount_value,
        discount_amount: entity.data.discount_amount,
        adjusted_subtotal: entity.data.adjusted_subtotal,
        tax_rate: entity.data.tax_rate,
        tax_amount: entity.data.tax_amount,
        total: entity.data.total,
      };

  const isNegative = totals.total < 0;
  const [isMinimized, setIsMinimized] = useState(false);
  // … (rest of function unchanged)
```

- [ ] Replace every read of `estimate.<field>` in the rest of the function body with `totals.<field>`:
  - `estimate.total` → `totals.total` (lines 147, 169, 265 in current file)
  - `estimate.subtotal` → `totals.subtotal` (line 202)
  - `estimate.markup_type` → `totals.markup_type` (line 208), same for `markup_value` (209), `markup_amount` (210)
  - `estimate.discount_type` → `totals.discount_type` (218), `discount_value` (219), `discount_amount` (220)
  - `estimate.adjusted_subtotal` → `totals.adjusted_subtotal` (229)
  - `estimate.tax_amount` → `totals.tax_amount` (236), `estimate.tax_rate` → `totals.tax_rate` (244)

- [ ] Run `grep -n "estimate\." src/components/estimate-builder/totals-panel.tsx` after the change and verify no remaining hits.

### Step 3.2 — SectionCard + SubsectionCard + LineItemRow: widen item/section types (C4 + C6)

The shape difference between `EstimateLineItem` and `InvoiceLineItem`:
- `estimate_id` vs `invoice_id` — never read by SectionCard/SubsectionCard/LineItemRow (verified via grep).
- `total` (estimate) vs `amount` (invoice) — LineItemRow does not read `.total`; it computes locally from `item.quantity * item.unit_price` (line 95).
- `xactimate_code` only on invoice — never read.

So the widening is purely type-level: accept `EstimateLineItem | InvoiceLineItem` for items, and `EstimateSection | InvoiceSection` for the section wrapper.

- [ ] Open `src/components/estimate-builder/line-item-row.tsx`. Locate the imports at line 18 and the `LineItemRowProps` at lines 24-28:

```tsx
import type { BuilderMode, EstimateLineItem } from "@/lib/types";

// …

export interface LineItemRowProps {
  item: EstimateLineItem;
  // …
  onChange: (next: Partial<EstimateLineItem>) => void;
  // …
}
```

- [ ] Replace with the widened import + a shared `BuilderLineItem` type alias defined inline:

```tsx
import type { BuilderMode, EstimateLineItem, InvoiceLineItem } from "@/lib/types";

// LineItemRow only reads { id, description, code, quantity, unit, unit_price }
// — fields that are name-compatible across both entity-kind line items.
// `.total` (estimate) vs `.amount` (invoice) is computed locally in the row,
// not read off the prop, so the widening is type-only.
export type BuilderLineItem = EstimateLineItem | InvoiceLineItem;

export interface LineItemRowProps {
  item: BuilderLineItem;
  // …
  onChange: (next: Partial<BuilderLineItem>) => void;
  // …
}
```

(Keep the rest of the file unchanged — `item.description`, `item.quantity`, etc. still resolve under the union since both members have those fields.)

- [ ] Open `src/components/estimate-builder/subsection-card.tsx`. Locate line 44:

```tsx
import type { BuilderMode, EstimateSection, EstimateLineItem } from "@/lib/types";
```

- [ ] Replace with:

```tsx
import type { BuilderMode, EstimateSection, InvoiceSection } from "@/lib/types";
import type { BuilderLineItem } from "./line-item-row";
```

- [ ] Locate line 51 (`SubsectionCardProps.subsection`):

```tsx
  subsection: EstimateSection & { items: EstimateLineItem[] };
```

- [ ] Replace with:

```tsx
  subsection:
    | (EstimateSection & { items: BuilderLineItem[] })
    | (InvoiceSection & { items: BuilderLineItem[] });
```

- [ ] Locate line 57:

```tsx
  onLineItemChange: (itemId: string, partial: Partial<EstimateLineItem>) => void;
```

- [ ] Replace with:

```tsx
  onLineItemChange: (itemId: string, partial: Partial<BuilderLineItem>) => void;
```

- [ ] Open `src/components/estimate-builder/section-card.tsx`. Locate line 57 and lines 63-84:

```tsx
import type { BuilderMode, EstimateSection, EstimateLineItem } from "@/lib/types";

// …

export interface SectionCardProps {
  section: EstimateSection & {
    items: EstimateLineItem[];
    subsections: Array<EstimateSection & { items: EstimateLineItem[] }>;
  };
  // …
  onLineItemChange: (itemId: string, partial: Partial<EstimateLineItem>) => void;
  // …
}
```

- [ ] Replace with:

```tsx
import type { BuilderMode, EstimateSection, InvoiceSection } from "@/lib/types";
import type { BuilderLineItem } from "./line-item-row";

// …

export interface SectionCardProps {
  section:
    | (EstimateSection & {
        items: BuilderLineItem[];
        subsections: Array<EstimateSection & { items: BuilderLineItem[] }>;
      })
    | (InvoiceSection & {
        items: BuilderLineItem[];
        subsections: Array<InvoiceSection & { items: BuilderLineItem[] }>;
      });
  // …
  onLineItemChange: (itemId: string, partial: Partial<BuilderLineItem>) => void;
  // …
}
```

(All other prop signatures unchanged — `onRename(id, title)` etc. don't depend on entity kind.)

### Step 3.3 — estimate-builder.tsx: invoice-mode local recompute (C3) + drop call-site casts (C5/C6)

This step touches several handlers in `estimate-builder.tsx`. Each one currently has a `prev.entity.kind === "estimate"` branch with `computeEstimateTotals` + `sumLineItemsFromSections`, and a `prev.entity.kind === "invoice"` branch that updates only the field. Goal: invoice branch also calls the same compute helpers, mapping the result's `total → total_amount`.

**Helper to share the math.** The result-key adapter is needed in 6 places below; define it once at the top of the file (after `serializeTemplateRootPut`, before `interface BuilderState`):

- [ ] Add (around line 128, just before `// Types`):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Local recompute helpers — wrap computeEstimateTotals so invoice-mode setState
// branches can update sub/markup/discount/tax/total_amount in lockstep with the
// estimate-mode branches. The math is identical; only the output field name for
// "total" differs (estimate.total vs invoice.total_amount).
// ─────────────────────────────────────────────────────────────────────────────

function applyEstimateTotals<T extends {
  subtotal: number;
  markup_type: import("@/lib/types").AdjustmentType;
  markup_value: number;
  discount_type: import("@/lib/types").AdjustmentType;
  discount_value: number;
  tax_rate: number;
}>(estimate: T): T & ReturnType<typeof computeEstimateTotals> {
  const t = computeEstimateTotals(estimate);
  return { ...estimate, ...t };
}

function applyInvoiceTotals<T extends {
  subtotal: number;
  markup_type: import("@/lib/types").AdjustmentType;
  markup_value: number;
  discount_type: import("@/lib/types").AdjustmentType;
  discount_value: number;
  tax_rate: number;
}>(invoice: T): T & {
  markup_amount: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_amount: number;
  total_amount: number;
} {
  const { total, ...rest } = computeEstimateTotals(invoice);
  return { ...invoice, ...rest, total_amount: total };
}
```

(`computeEstimateTotals` is already imported at line 22.)

- [ ] **`onMarkupChange`** (lines 475-496). Replace the invoice branch:

Before (lines 485-493):
```ts
      if (prev.entity.kind === "invoice") {
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, markup_type: type, markup_value: value },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          markup_type: type,
          markup_value: value,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

- [ ] **`onDiscountChange`** (lines 498-519). Same shape — replace invoice branch (lines 508-516):

Before:
```ts
      if (prev.entity.kind === "invoice") {
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, discount_type: type, discount_value: value },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          discount_type: type,
          discount_value: value,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

- [ ] **`onTaxRateChange`** (lines 521-543). Replace invoice branch (lines 532-540):

Before:
```ts
      if (prev.entity.kind === "invoice") {
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, tax_rate: clamped },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          tax_rate: clamped,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

- [ ] **`onLineItemDelete`** (lines 936-1034). The invoice branch (lines 984-1003) currently only removes the item from local state. Add subtotal recompute + totals recompute, mirroring the estimate branch (lines 967-983):

Before (the inner invoice branch):
```ts
      if (prev.entity.kind === "invoice") {
        // Invoice mode: optimistic local removal only — server reconciles totals
        // via recalculateInvoiceTotals on the DELETE route, and the next root PUT
        // / page refresh picks up authoritative values.
        const sections_after = prev.entity.data.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        }));
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        // Invoice mode: optimistic local removal + local totals recompute so the
        // TotalsPanel updates instantly. Server reconciles authoritative values
        // via recalculateInvoiceTotals on the DELETE route + next root PUT.
        const sections_after = prev.entity.data.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

- [ ] **`onLineItemChange`** (lines 1038-1120). Now that LineItemRow's onChange returns `Partial<BuilderLineItem>`, update the parameter type:

Before (line 1038):
```ts
  function onLineItemChange(itemId: string, partial: Partial<EstimateLineItem>) {
```

After:
```ts
  function onLineItemChange(
    itemId: string,
    partial: Partial<import("@/lib/types").EstimateLineItem | import("@/lib/types").InvoiceLineItem>,
  ) {
```

(The `BuilderLineItem` re-export from `line-item-row.tsx` could also be imported here; using the inline import keeps the diff localized. Either is fine — pick whichever the implementer finds cleaner.)

Then replace the invoice branch (lines 1087-1116) — drop the `as any` casts and add local recompute:

Before:
```ts
      if (prev.entity.kind === "invoice") {
        // Task 43: invoice mode — optimistic local edit; totals recompute
        // happens server-side via recalculateInvoiceTotals on the line-item PUT.
        // The TotalsPanel may briefly show stale totals until auto-save returns.
        const sections_after = prev.entity.data.sections.map((sec) => ({
          ...sec,
          // Cast: partial is typed as Partial<EstimateLineItem>; runtime fields
          // line up with InvoiceLineItem for the editable subset (description,
          // quantity, unit_price, code, unit).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: sec.items.map((item) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            item.id === itemId ? ({ ...item, ...(partial as any) }) : item
          ),
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            items: sub.items.map((item) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              item.id === itemId ? ({ ...item, ...(partial as any) }) : item
            ),
          })),
        }));
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        // Cast partial to invoice-shaped Partial inside the invoice narrowing —
        // the editable subset (description, code, quantity, unit, unit_price)
        // is name-compatible across both kinds.
        const invoicePartial = partial as Partial<import("@/lib/types").InvoiceLineItem>;
        const sections_after = prev.entity.data.sections.map((sec) => ({
          ...sec,
          items: sec.items.map((item) =>
            item.id === itemId ? { ...item, ...invoicePartial } : item
          ),
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            items: sub.items.map((item) =>
              item.id === itemId ? { ...item, ...invoicePartial } : item
            ),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

(The single inner cast `partial as Partial<InvoiceLineItem>` replaces the four `as any` spreads; tsc accepts it because the union member type is reachable from the parameter type. No more eslint-disable lines.)

- [ ] **`onLineItemAdded`** (lines 1126-1213). Same shape — drop `as any` casts and add local recompute. The `newItem` parameter is currently typed `EstimateLineItem`; widen to `BuilderLineItem`:

Before (line 1126):
```ts
  function onLineItemAdded(newItem: EstimateLineItem) {
```

After:
```ts
  function onLineItemAdded(
    newItem: import("@/lib/types").EstimateLineItem | import("@/lib/types").InvoiceLineItem,
  ) {
```

Then replace the invoice branch (lines 1180-1209):

Before:
```ts
      if (prev.entity.kind === "invoice") {
        // Task 43: invoice mode — server reconciles totals via
        // recalculateInvoiceTotals on the line-item POST; we splice the new
        // item locally so it appears immediately. TotalsPanel may show briefly
        // stale totals until the next auto-save settles.
        // Note: the invoice POST route returns the raw row whose total field
        // is `amount` (not `total`). AddItemDialog still types it as
        // EstimateLineItem; cast through any to splice into invoice-shape arrays.
        const sections_after = prev.entity.data.sections.map((sec) => {
          if (sec.id === newItem.section_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { ...sec, items: [...sec.items, newItem as any] };
          }
          return {
            ...sec,
            subsections: sec.subsections.map((sub) =>
              sub.id === newItem.section_id
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? { ...sub, items: [...sub.items, newItem as any] }
                : sub
            ),
          };
        });
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      }
```

After:
```ts
      if (prev.entity.kind === "invoice") {
        // Cast inside the invoice narrowing — POST returns an InvoiceLineItem
        // (now wrapped via Task 1's C1 fix) so the widened newItem is the
        // correct shape at runtime.
        const invoiceItem = newItem as import("@/lib/types").InvoiceLineItem;
        const sections_after = prev.entity.data.sections.map((sec) => {
          if (sec.id === invoiceItem.section_id) {
            return { ...sec, items: [...sec.items, invoiceItem] };
          }
          return {
            ...sec,
            subsections: sec.subsections.map((sub) =>
              sub.id === invoiceItem.section_id
                ? { ...sub, items: [...sub.items, invoiceItem] }
                : sub
            ),
          };
        });
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
```

- [ ] **TotalsPanel call sites.** With the C5 prop change, the two render sites become much simpler.

Invoice branch (lines 1487 + 1660-1667):

Before:
```ts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceForTotals = { ...invoice, total: invoice.total_amount } as any;
    // … later in JSX:
        <TotalsPanel
          estimate={invoiceForTotals}
          onMarkupChange={onMarkupChange}
          onDiscountChange={onDiscountChange}
          onTaxRateChange={onTaxRateChange}
          readOnly={isVoided}
          mode={invMode}
        />
```

After:
- Delete the `invoiceForTotals` line entirely.
- Update the JSX to:

```ts
        <TotalsPanel
          entity={invoiceEntity}
          onMarkupChange={onMarkupChange}
          onDiscountChange={onDiscountChange}
          onTaxRateChange={onTaxRateChange}
          readOnly={isVoided}
          mode={invMode}
        />
```

Estimate branch (around line 1888, search for the estimate-mode TotalsPanel render after the invoice branch):

Before — the estimate branch passes `estimate={state.entity.data}` (look it up at the existing call-site, around line 2076 area):

```ts
        <TotalsPanel
          estimate={state.entity.data}
          onMarkupChange={onMarkupChange}
          onDiscountChange={onDiscountChange}
          onTaxRateChange={onTaxRateChange}
          readOnly={isVoided}
        />
```

After:
```ts
        <TotalsPanel
          entity={state.entity}
          onMarkupChange={onMarkupChange}
          onDiscountChange={onDiscountChange}
          onTaxRateChange={onTaxRateChange}
          readOnly={isVoided}
        />
```

(Use `grep -n "<TotalsPanel" src/components/estimate-builder/estimate-builder.tsx` to locate every render site and update each one. There should be exactly two — invoice and estimate. Template branch doesn't render TotalsPanel at all.)

- [ ] **SectionCard call sites.** With C6's widened types, the casts go away.

Invoice branch (lines 1566-1587):

Before — focus on the cast lines:
```ts
                    <SectionCard
                      key={sec.id}
                      // Invoice sections are structurally compatible …
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      section={sec as any}
                      // …
```

After — drop the cast and the eslint-disable:
```ts
                    <SectionCard
                      key={sec.id}
                      section={sec}
                      // …
```

Template branch (lines 1747-1764) — has a similar cast around line 1755. SectionCard's widened type still doesn't accept the template's `TemplateWithContents['sections'][number]` shape (no organization_id, no estimate_id/invoice_id). For the template branch, keep ONE narrow cast — the simplest path is `section={sec as unknown as SectionCardProps["section"]}` and a tightened comment:

```ts
                    <SectionCard
                      key={sec.id}
                      // Template sections lack the EstimateSection/InvoiceSection
                      // scalar fields (organization_id, estimate_id|invoice_id,
                      // created_at, updated_at). SectionCard only reads
                      // id/title/sort_order/items/subsections, so cast through
                      // unknown is safe at runtime.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      section={sec as any}
                      // …
```

(Leaving the template cast as `as any` matches existing pattern. If the implementer wants to further reduce the cast, define a third union member of SectionCardProps.section that matches the template-section structural shape — out of scope for this commit.)

### Step 3.4 — Verify

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors. If errors appear, the most likely cause is a remaining call-site that read a now-removed `estimate.X` field on `TotalsPanel`, or a SectionCard caller that wasn't updated. Address each in turn.

- [ ] Run:

```bash
npm run build
```

Expected: ✓ Compiled successfully.

- [ ] Manual preview verification:
  1. **Estimate mode regression check:** Open an existing estimate, edit a line item's quantity → TotalsPanel's subtotal/total update instantly (still works).
  2. **Invoice mode C3 verification:** Open an invoice, edit a line item's quantity → TotalsPanel's subtotal/total update instantly (was previously stale until auto-save).
  3. **Invoice mode markup/discount/tax:** Toggle markup type, change tax rate → totals update instantly.
  4. **Invoice mode delete line item:** Delete an item → totals reflect the removal instantly.
  5. **Invoice mode add line item:** Add a library item → row appears + totals update instantly.

### Step 3.5 — Commit

- [ ] Stage and commit:

```bash
git add src/components/estimate-builder/totals-panel.tsx \
        src/components/estimate-builder/section-card.tsx \
        src/components/estimate-builder/subsection-card.tsx \
        src/components/estimate-builder/line-item-row.tsx \
        src/components/estimate-builder/estimate-builder.tsx
git commit -m "refactor(67b): C3-C6 polymorphism — TotalsPanel/SectionCard/LineItemRow accept BuilderEntity, invoice-mode local recompute"
```

---

## Task 4 — Migration RPC cleanups (I2 + I4 + minors M3/M4/M6/M7/M8)

**Goal:** New migration file containing `CREATE OR REPLACE FUNCTION` for both `convert_estimate_to_invoice` and `apply_template_to_estimate`, with I2's regex-safe settings cast and I4's inline totals recompute. M-series minors are mostly comment cleanups inside the same definitions.

**Files:**
- Create: `supabase/migration-build67b-cleanup.sql`
- Apply: via Supabase Studio (manual; per memory, migrations are not idempotent and must be run by hand)

### Step 4.1 — Create the migration file

- [ ] Create `supabase/migration-build67b-cleanup.sql` with the following content. The file re-creates both RPCs in full (PostgreSQL `CREATE OR REPLACE FUNCTION` requires the entire body), with the targeted changes below clearly commented.

The two RPC bodies are mostly identical to the originals at `supabase/migration-build67b-conversion-and-template-apply.sql`. The diffs are:

**convert_estimate_to_invoice (I2 + M5/M8 comment header):**
- Lines 63-66 (I2): replace the unguarded `::integer` cast with a regex-validated cast that falls back to 30 if the value isn't a clean integer literal.

**apply_template_to_estimate (I4 + M3/M4/M6/M7 comment cleanups):**
- After line 367 (`END LOOP` of sections), BEFORE the existing `UPDATE estimates SET updated_at = now()` at line 380, insert the same totals-recompute logic that `convert_estimate_to_invoice` runs (mirror lines 134-170 of the original migration, swapping `v_new_invoice_id`/`invoices` → `p_estimate_id`/`estimates` and reading the estimate's own markup/discount/tax fields).
- Replace the existing line 380 `UPDATE estimates SET updated_at = now()` with the totals-update statement (which also bumps `updated_at`).
- M3: add a comment near line 269 (`v_unit := v_lib.default_unit;`) clarifying that template can't override `unit`/`code` — library-only by design.
- M4: rename local var `v_section_count` (declared line 189) → `v_existing_section_count` to disambiguate from `v_section_count_out`.
- M6/M7: add `COALESCE(... , 0)` defaults around any `v_lib.default_quantity` / `v_lib.unit_price` reads where the lib row was found but the column happened to be NULL (defensive — schema disallows it, but cheap safety).
- M8: add a top-of-function header comment block listing the `RAISE EXCEPTION` strings + their consumer route handlers, so future maintainers don't change the strings and silently break route error mapping.

Write the file as:

```sql
-- Build 67b cleanup — RPC fixes (I2, I4) + minor comment / variable cleanups (M3/M4/M6/M7/M8)
-- Spec: docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md
-- Plan: docs/superpowers/plans/2026-05-02-build-67b-cleanup.md (Task 4)

-- ============================================================================
-- 1. convert_estimate_to_invoice — I2 fix: regex-safe settings cast
-- ============================================================================
-- Header: this RPC is invoked by POST /api/estimates/[id]/convert (route maps
--   the RAISE EXCEPTION strings below to HTTP responses; do NOT change the
--   strings without updating the route):
--     'estimate_not_found'           → 404
--     'estimate_not_approved'        → 409 (must be approved before convert)
--     'estimate_already_converted:%' → 409 (existing_invoice_id parsed from %)
--   ERRCODE: P0001 = client-recoverable; P0002 = not-found.
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(p_estimate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_estimate     estimates%ROWTYPE;
  v_org_id       uuid;
  v_job_id       uuid;
  v_inv_number   text;
  v_inv_seq      integer;
  v_due_days_raw text;
  v_due_days     integer;
  v_due_date     date;
  v_new_invoice_id uuid;
  v_section      record;
  v_subsection   record;
  v_section_map  jsonb := '{}'::jsonb;
  v_old_section_id uuid;
  v_new_section_id uuid;
  v_item         record;
  v_subtotal     numeric(10,2) := 0;
  v_markup_amt   numeric(10,2) := 0;
  v_discount_amt numeric(10,2) := 0;
  v_adjusted     numeric(10,2) := 0;
  v_tax_amt      numeric(10,2) := 0;
  v_total        numeric(10,2) := 0;
BEGIN
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

  SELECT t.invoice_number, t.sequence_number
    INTO v_inv_number, v_inv_seq
    FROM generate_invoice_number(v_job_id) t;

  -- I2 fix: defensive cast for default_invoice_due_days. The settings UI
  -- validates input, but a malformed value here would otherwise raise
  -- 22P02 invalid_text_representation and abort the entire conversion.
  -- Read raw, regex-check, then cast — falling back to 30 on any miss.
  SELECT value INTO v_due_days_raw
    FROM company_settings
   WHERE organization_id = v_org_id AND key = 'default_invoice_due_days';
  IF v_due_days_raw IS NULL OR v_due_days_raw !~ '^\s*-?\d+\s*$' THEN
    v_due_days := 30;
  ELSE
    v_due_days := v_due_days_raw::integer;
    IF v_due_days < 0 THEN v_due_days := 30; END IF;
  END IF;
  v_due_date := CURRENT_DATE + v_due_days;

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

  FOR v_section IN
    SELECT id, title, sort_order FROM estimate_sections
     WHERE estimate_id = p_estimate_id AND parent_section_id IS NULL
     ORDER BY sort_order
  LOOP
    INSERT INTO invoice_sections (organization_id, invoice_id, parent_section_id, title, sort_order)
    VALUES (v_org_id, v_new_invoice_id, NULL, v_section.title, v_section.sort_order)
    RETURNING id INTO v_new_section_id;
    v_section_map := jsonb_set(v_section_map, ARRAY[v_section.id::text], to_jsonb(v_new_section_id));
  END LOOP;

  FOR v_subsection IN
    SELECT id, title, sort_order, parent_section_id FROM estimate_sections
     WHERE estimate_id = p_estimate_id AND parent_section_id IS NOT NULL
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_subsection.parent_section_id;
    INSERT INTO invoice_sections (organization_id, invoice_id, parent_section_id, title, sort_order)
    VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_subsection.title, v_subsection.sort_order
    )
    RETURNING id INTO v_new_section_id;
    v_section_map := jsonb_set(v_section_map, ARRAY[v_subsection.id::text], to_jsonb(v_new_section_id));
  END LOOP;

  FOR v_item IN
    SELECT id, section_id, library_item_id, description, code,
           quantity, unit, unit_price, total, sort_order
      FROM estimate_line_items
     WHERE estimate_id = p_estimate_id
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_item.section_id;
    -- xactimate_code dual-write retained pending I1 cleanup (deferred to 67c).
    INSERT INTO invoice_line_items (
      organization_id, invoice_id, section_id, library_item_id,
      description, code, quantity, unit, unit_price, amount, sort_order, xactimate_code
    ) VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_item.library_item_id,
      v_item.description, v_item.code, v_item.quantity, v_item.unit,
      v_item.unit_price, v_item.total, v_item.sort_order, v_item.code
    );
    v_subtotal := v_subtotal + v_item.total;
  END LOOP;

  v_subtotal := round(v_subtotal::numeric, 2);

  UPDATE estimates SET
    status = 'converted',
    converted_to_invoice_id = v_new_invoice_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_estimate_id;

  v_markup_amt := CASE v_estimate.markup_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.markup_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.markup_value::numeric, 2)
    ELSE 0
  END;
  v_discount_amt := CASE v_estimate.discount_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.discount_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.discount_value::numeric, 2)
    ELSE 0
  END;
  v_adjusted := round((v_subtotal + v_markup_amt - v_discount_amt)::numeric, 2);
  v_tax_amt  := round((v_adjusted * v_estimate.tax_rate / 100)::numeric, 2);
  v_total    := round((v_adjusted + v_tax_amt)::numeric, 2);

  UPDATE invoices SET
    subtotal = v_subtotal,
    markup_amount = v_markup_amt,
    discount_amount = v_discount_amt,
    adjusted_subtotal = v_adjusted,
    tax_amount = v_tax_amt,
    total_amount = v_total,
    updated_at = now()
  WHERE id = v_new_invoice_id;

  RETURN v_new_invoice_id;
END;
$$;

-- ============================================================================
-- 2. apply_template_to_estimate — I4 fix: inline totals recompute + M3/M4/M6/M7/M8
-- ============================================================================
-- Header: this RPC is invoked by POST /api/estimates/[id]/apply-template
--   (route maps the RAISE EXCEPTION strings below to HTTP responses; do NOT
--   change the strings without updating the route):
--     'estimate_not_found'              → 404
--     'estimate_not_draft'              → 409 (template can only apply to draft)
--     'estimate_not_empty'              → 409 (must be empty before apply)
--     'template_not_found_or_inactive'  → 404
--   ERRCODE: P0001 = client-recoverable; P0002 = not-found.
-- M3 note: the body fills `unit` and `code` from the library item only —
--   templates never override these fields by design (per spec §4).
CREATE OR REPLACE FUNCTION apply_template_to_estimate(
  p_estimate_id uuid,
  p_template_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_estimate    estimates%ROWTYPE;
  v_template    estimate_templates%ROWTYPE;
  v_existing_section_count integer; -- M4 rename: was v_section_count (clashes visually with v_section_count_out)
  v_struct      jsonb;
  v_section     jsonb;
  v_subsection  jsonb;
  v_item        jsonb;
  v_section_idx integer := 0;
  v_subsection_idx integer := 0;
  v_item_idx    integer;
  v_new_section_id uuid;
  v_new_subsection_id uuid;
  v_lib_id      uuid;
  v_lib         item_library%ROWTYPE;
  v_desc        text;
  v_qty         numeric(10,2);
  v_unit_price  numeric(10,2);
  v_unit        text;
  v_code        text;
  v_total       numeric(10,2);
  v_broken_refs jsonb := '[]'::jsonb;
  v_section_count_out integer := 0;
  v_line_item_count_out integer := 0;
  v_placeholder bool;
  v_ref_obj     jsonb;
  -- I4 totals scratchpad
  v_subtotal     numeric(10,2) := 0;
  v_markup_amt   numeric(10,2) := 0;
  v_discount_amt numeric(10,2) := 0;
  v_adjusted     numeric(10,2) := 0;
  v_tax_amt      numeric(10,2) := 0;
  v_total_out    numeric(10,2) := 0;
BEGIN
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.status <> 'draft' THEN
    RAISE EXCEPTION 'estimate_not_draft' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_existing_section_count
    FROM estimate_sections WHERE estimate_id = p_estimate_id;
  IF v_existing_section_count > 0 THEN
    RAISE EXCEPTION 'estimate_not_empty' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_template FROM estimate_templates WHERE id = p_template_id;
  IF v_template.id IS NULL OR v_template.is_active = false
     OR v_template.organization_id <> v_estimate.organization_id THEN
    RAISE EXCEPTION 'template_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  v_struct := v_template.structure;

  FOR v_section IN SELECT * FROM jsonb_array_elements(COALESCE(v_struct->'sections', '[]'::jsonb))
  LOOP
    INSERT INTO estimate_sections (organization_id, estimate_id, parent_section_id, title, sort_order)
    VALUES (
      v_estimate.organization_id, p_estimate_id, NULL,
      v_section->>'title',
      COALESCE((v_section->>'sort_order')::integer, v_section_idx)
    )
    RETURNING id INTO v_new_section_id;
    v_section_count_out := v_section_count_out + 1;

    v_item_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_section->'items', '[]'::jsonb))
    LOOP
      v_lib_id := NULLIF(v_item->>'library_item_id', '')::uuid;
      v_placeholder := false;
      IF v_lib_id IS NOT NULL THEN
        SELECT * INTO v_lib FROM item_library
         WHERE id = v_lib_id AND is_active = true
           AND organization_id = v_estimate.organization_id;
      ELSE
        v_lib.id := NULL;
      END IF;
      v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
      -- M6: COALESCE the lib defaults explicitly in case schema relaxes NOT NULL later.
      v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
      v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
      -- M3: unit + code are library-only — templates never override.
      v_unit := v_lib.default_unit;
      v_code := v_lib.code;
      v_total := round((v_qty * v_unit_price)::numeric, 2);

      IF v_lib_id IS NOT NULL AND v_lib.id IS NULL THEN
        v_placeholder := (
             (v_item->>'description_override') IS NULL
          AND (v_item->>'quantity_override')   IS NULL
          AND (v_item->>'unit_price_override') IS NULL
        );
        v_ref_obj := jsonb_build_object(
          'section_idx', v_section_idx,
          'item_idx',    v_item_idx,
          'library_item_id', v_lib_id,
          'placeholder', v_placeholder
        );
        v_broken_refs := v_broken_refs || jsonb_build_array(v_ref_obj);
      END IF;

      INSERT INTO estimate_line_items (
        organization_id, estimate_id, section_id, library_item_id,
        description, code, quantity, unit, unit_price, total, sort_order
      ) VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
        v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
        COALESCE((v_item->>'sort_order')::integer, v_item_idx)
      );
      v_subtotal := v_subtotal + v_total;
      v_line_item_count_out := v_line_item_count_out + 1;
      v_item_idx := v_item_idx + 1;
    END LOOP;

    v_subsection_idx := 0;
    FOR v_subsection IN SELECT * FROM jsonb_array_elements(COALESCE(v_section->'subsections', '[]'::jsonb))
    LOOP
      INSERT INTO estimate_sections (organization_id, estimate_id, parent_section_id, title, sort_order)
      VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        v_subsection->>'title',
        COALESCE((v_subsection->>'sort_order')::integer, v_subsection_idx)
      )
      RETURNING id INTO v_new_subsection_id;
      v_section_count_out := v_section_count_out + 1;

      v_item_idx := 0;
      FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_subsection->'items', '[]'::jsonb))
      LOOP
        v_lib_id := NULLIF(v_item->>'library_item_id', '')::uuid;
        v_placeholder := false;
        IF v_lib_id IS NOT NULL THEN
          SELECT * INTO v_lib FROM item_library
           WHERE id = v_lib_id AND is_active = true
             AND organization_id = v_estimate.organization_id;
        ELSE
          v_lib.id := NULL;
        END IF;
        v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
        -- M7: same defensive COALESCE as the parent-section branch.
        v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
        v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
        v_unit := v_lib.default_unit;
        v_code := v_lib.code;
        v_total := round((v_qty * v_unit_price)::numeric, 2);

        IF v_lib_id IS NOT NULL AND v_lib.id IS NULL THEN
          v_placeholder := (
               (v_item->>'description_override') IS NULL
            AND (v_item->>'quantity_override')   IS NULL
            AND (v_item->>'unit_price_override') IS NULL
          );
          v_ref_obj := jsonb_build_object(
            'section_idx', v_section_idx,
            'item_idx',    v_item_idx,
            'library_item_id', v_lib_id,
            'placeholder', v_placeholder,
            'in_subsection', true,
            'subsection_idx', v_subsection_idx
          );
          v_broken_refs := v_broken_refs || jsonb_build_array(v_ref_obj);
        END IF;

        INSERT INTO estimate_line_items (
          organization_id, estimate_id, section_id, library_item_id,
          description, code, quantity, unit, unit_price, total, sort_order
        ) VALUES (
          v_estimate.organization_id, p_estimate_id, v_new_subsection_id,
          CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
          v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
          COALESCE((v_item->>'sort_order')::integer, v_item_idx)
        );
        v_subtotal := v_subtotal + v_total;
        v_line_item_count_out := v_line_item_count_out + 1;
        v_item_idx := v_item_idx + 1;
      END LOOP;
      v_subsection_idx := v_subsection_idx + 1;
    END LOOP;

    v_section_idx := v_section_idx + 1;
  END LOOP;

  IF v_template.opening_statement IS NOT NULL AND v_template.opening_statement <> '' THEN
    UPDATE estimates SET opening_statement = v_template.opening_statement
     WHERE id = p_estimate_id;
  END IF;
  IF v_template.closing_statement IS NOT NULL AND v_template.closing_statement <> '' THEN
    UPDATE estimates SET closing_statement = v_template.closing_statement
     WHERE id = p_estimate_id;
  END IF;

  -- I4 fix: inline totals recompute, mirroring convert_estimate_to_invoice.
  -- Previously this RPC only bumped updated_at; the route handler called
  -- recalculateTotals() in TS afterward. Direct callers (Studio / future
  -- code / manual ops) would otherwise leave subtotal/total stale.
  v_subtotal := round(v_subtotal::numeric, 2);
  v_markup_amt := CASE v_estimate.markup_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.markup_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.markup_value::numeric, 2)
    ELSE 0
  END;
  v_discount_amt := CASE v_estimate.discount_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.discount_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.discount_value::numeric, 2)
    ELSE 0
  END;
  v_adjusted := round((v_subtotal + v_markup_amt - v_discount_amt)::numeric, 2);
  v_tax_amt  := round((v_adjusted * v_estimate.tax_rate / 100)::numeric, 2);
  v_total_out := round((v_adjusted + v_tax_amt)::numeric, 2);

  UPDATE estimates SET
    subtotal = v_subtotal,
    markup_amount = v_markup_amt,
    discount_amount = v_discount_amt,
    adjusted_subtotal = v_adjusted,
    tax_amount = v_tax_amt,
    total = v_total_out,
    updated_at = now()
  WHERE id = p_estimate_id;

  RETURN jsonb_build_object(
    'section_count', v_section_count_out,
    'line_item_count', v_line_item_count_out,
    'broken_refs', v_broken_refs
  );
END;
$$;

-- ============================================================================
-- 3. Re-grants — necessary because CREATE OR REPLACE preserves grants in PG 15+,
--   but include them explicitly for parity with the original migration.
-- ============================================================================
GRANT EXECUTE ON FUNCTION convert_estimate_to_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_template_to_estimate(uuid, uuid) TO authenticated;
```

### Step 4.2 — Apply the migration

Per project memory, migrations are applied manually (not via `supabase db push`). Two options:
- (a) Paste into Supabase Studio → SQL Editor → run.
- (b) Use the local `mcp__31d06679-..._apply_migration` tool with name `build67b-cleanup` and the file contents — same effect.

- [ ] Apply via the chosen path. Confirm both RPCs are replaced (no error returned).

### Step 4.3 — Verify the RPCs

- [ ] In SQL Editor (or via `mcp__31d06679-..._execute_sql`), test the I2 fix with a malformed setting:

```sql
-- Temporarily set a bad value (replace ORG_UUID with the AAA org id)
UPDATE company_settings
   SET value = 'abc'
 WHERE organization_id = 'ORG_UUID' AND key = 'default_invoice_due_days';
```

Then attempt to convert an approved estimate (use a throwaway test estimate, NOT real customer data). Expected: conversion succeeds and `due_date` = today + 30 days (the fallback). Pre-fix: would have raised `22P02 invalid_text_representation`.

Restore the setting:
```sql
UPDATE company_settings
   SET value = '30'
 WHERE organization_id = 'ORG_UUID' AND key = 'default_invoice_due_days';
```

- [ ] Test the I4 fix: create a draft estimate with markup 10% + tax 8% → apply a template that has 2 line items totaling $100. After the RPC returns, query:

```sql
SELECT subtotal, markup_amount, tax_amount, total
  FROM estimates
 WHERE id = 'TEST_ESTIMATE_UUID';
```

Expected: `subtotal=100, markup_amount=10, tax_amount=8.80, total=118.80`. Pre-fix: all four would be 0 (the route handler's `recalculateTotals` wouldn't have run if you skipped the route).

### Step 4.4 — tsc + build

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors. (No code paths call these RPCs differently — the route handlers' shapes are unchanged.)

- [ ] Run:

```bash
npm run build
```

Expected: ✓ Compiled successfully.

### Step 4.5 — Commit

- [ ] Stage and commit:

```bash
git add supabase/migration-build67b-cleanup.sql
git commit -m "fix(67b): I2 regex-safe settings cast + I4 inline totals recompute + M-series cleanups in 67b RPCs"
```

---

## Task 5 — Session-8 minors + V1 closeout + chips doc final pass

**Goal:** Two small code touches and the bookkeeping that closes 67b.

**Files:**
- Modify: `src/components/estimate-builder/header-bar.tsx` (drop redundant `isVoided` term)
- Modify: `src/components/estimate-builder/add-item-dialog.tsx` (drop forged `organization_id: ""` sentinels)
- Modify: `docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md`
- Modify: `docs/vault/00-NOW.md`

### Step 5.1 — HeaderBar redundant disabled term

- [ ] Open `src/components/estimate-builder/header-bar.tsx`. Locate the estimate-mode Void button at lines 372-383:

```tsx
        {est.status !== "voided" && est.status !== "converted" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isVoided || isVoiding}
            title={isVoided ? "Already voided" : isVoiding ? "Voiding…" : undefined}
            onClick={() => setVoidOpen(true)}
          >
            <Ban size={14} />
            Void
          </Button>
        )}
```

The wrapping `{est.status !== "voided" && ...}` already gates the entire button on non-voided status. So `isVoided` (which is `entity.kind !== "template" && entity.data.status === "voided"`) is provably `false` whenever this button renders. The `disabled={isVoided || isVoiding}` and `title` branches are dead code.

- [ ] Replace with:

```tsx
        {est.status !== "voided" && est.status !== "converted" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isVoiding}
            title={isVoiding ? "Voiding…" : undefined}
            onClick={() => setVoidOpen(true)}
          >
            <Ban size={14} />
            Void
          </Button>
        )}
```

### Step 5.2 — AddItemDialog template-mode `organization_id: ""` sentinel

- [ ] Open `src/components/estimate-builder/add-item-dialog.tsx`. Locate lines 148-163 (the library-add template branch) and lines 372-387 (the custom-add template branch). Both build a synthetic `EstimateLineItem` with hand-forged `organization_id: ""` and `created_at`/`updated_at`/`estimate_id` fields.

The synthetic item is fed straight into `onAdded(localItem)` → `onLineItemAdded` (estimate-builder.tsx:1126). With Task 3's change, `onLineItemAdded`'s parameter is widened to `EstimateLineItem | InvoiceLineItem`. Templates never use those scalar fields downstream — only id, library_item_id, description, code, quantity, unit, unit_price, sort_order, section_id are read. The `as EstimateLineItem` declaration is what forces these dummy strings.

Two approaches:
- (a) Define a narrow `BuilderTemplateLineItem` shape carrying just the fields actually read, then loosen `onLineItemAdded` to accept that union member.
- (b) Keep the cast but build the object via `as unknown as EstimateLineItem` so the dummy fields don't visually pollute the call site.

Approach (a) is cleaner long-term but expands the polymorphism work into a 5th union member. Approach (b) is the smaller diff for this cleanup commit. **Pick (b) unless Task 3 already added a template-line-item type — then prefer (a).**

For approach (b): Replace lines 148-163:

Before:
```tsx
        const now = new Date().toISOString();
        const localItem: EstimateLineItem = {
          id: crypto.randomUUID(),
          organization_id: "",
          estimate_id: estimateId,
          section_id: sectionId,
          library_item_id: libItem.id,
          description: libItem.name,
          code: libItem.code ?? null,
          quantity: libItem.default_quantity,
          unit: libItem.default_unit ?? null,
          unit_price: libItem.unit_price,
          total: libItem.default_quantity * libItem.unit_price,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        };
        onAdded(localItem);
```

After:
```tsx
        // Template mode: build only the fields downstream actually reads.
        // Cast through unknown — onLineItemAdded's parameter is widened to
        // EstimateLineItem | InvoiceLineItem; the template branch only
        // touches id, library_item_id, description, code, quantity, unit,
        // unit_price, sort_order, section_id (see estimate-builder
        // onLineItemAdded template branch ~line 1129).
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: libItem.id,
          description: libItem.name,
          code: libItem.code ?? null,
          quantity: libItem.default_quantity,
          unit: libItem.default_unit ?? null,
          unit_price: libItem.unit_price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
        onAdded(localItem);
```

(The `total`, `organization_id`, `estimate_id`, `created_at`, `updated_at` fields are dropped — they were never read.)

- [ ] Apply the same change to lines 372-387 (the custom-add template branch). Pattern is identical; replace forged fields with the minimum set + `as unknown as EstimateLineItem`.

### Step 5.3 — Verify code changes

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] Run:

```bash
npm run build
```

Expected: ✓ Compiled successfully.

- [ ] Manual preview:
  - Open an estimate template, add an item from library and a custom item — both appear in the section. Save Template (or wait for auto-save). Reload → items persist with correct fields.
  - On an estimate, attempt to Void → dialog opens normally, button disables only while voiding (no behavioral change visible).

### Step 5.4 — Update the chips doc

- [ ] Open `docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md`. At the very top (after the title and the intro paragraph), prepend a "Resolved" section. The chips doc structure already lists each chip — add a strikethrough or "(closed in <commit>)" marker per resolved chip.

The cleanest approach: append a new section at the bottom titled `## Closed in 67b cleanup pass (2026-05-02 session)` listing each chip and the commit that closed it (use `git log -5 --oneline` after Task 4 commit to fill in the exact short SHAs):

```markdown
---

## Closed in 67b cleanup pass (2026-05-02 session)

Plan: `docs/superpowers/plans/2026-05-02-build-67b-cleanup.md`

- **C1** — invoice POST line-items response shape — closed in `<task1-sha>`
- **C2** — invoice-mode drag-reorder — closed in `<task2-sha>`
- **C3** — invoice-mode totals don't recompute locally — closed in `<task3-sha>`
- **C4** — onLineItemChange/onLineItemAdded `as any` casts — closed in `<task3-sha>`
- **C5** — TotalsPanel `total: invoice.total_amount` aliasing — closed in `<task3-sha>`
- **C6** — SectionCard `as any` cast for invoice/template sections — closed in `<task3-sha>` (template branch retains a single narrow cast — declared acceptable; see plan Step 3.3)
- **C7** — `/invoices` list page lost Customer + QB columns — restored in `<task1-sha>` (QB column shows `—` when null; per-org QB connection conditioning deferred as a follow-up if needed)
- **I2** — `default_invoice_due_days` settings cast — closed in `<task4-sha>`
- **I4** — `apply_template_to_estimate` doesn't recompute estimate totals inline — closed in `<task4-sha>`
- **M3 / M4 / M6 / M7 / M8** — minor RPC cleanups — folded into `<task4-sha>`
- **HeaderBar redundant `isVoided` disabled term** — closed in `<task5-sha>`
- **AddItemDialog template-mode `organization_id: ""` sentinel** — closed in `<task5-sha>`
- **V1** — `use-auto-save.ts` manual browser verification — covered by Build 67b §11 manual test pass (Test 15), 2026-05-02 session 9. Closed by reference.

## Still deferred

- **I1** — `xactimate_code` dual-write in convert RPC — Option C: keep until 67c retires the column. Re-evaluate if 67c slips materially.
- **5xx error redactor sweep across remaining ~80 routes** — separate chip; not 67b scope.
```

### Step 5.5 — Update 00-NOW.md

- [ ] Open `docs/vault/00-NOW.md`. Two edits:

(a) Update the front-matter `last_verified` line at the top (line 2). Change to today's date with a note that 67b is fully shipped:

Before:
```
last_verified: 2026-05-02 (session 9 — 67b complete; 52/52 tasks done, §11 test pass 15/15)
```

After:
```
last_verified: 2026-05-02 (session 10 — 67b cleanup pass shipped; all chips C1–C7 + I2 + I4 + M-series + session-8 minors closed; V1 closed by reference)
```

(b) Update the [[build-67b]] paragraph under "## Current build" — replace the trailing sentence "**67b cleanup pass not yet run** — 7+ chips outstanding…" with:

```
**67b cleanup pass shipped 2026-05-02 (session 10).** Five focused commits closed all C1–C7, I2, I4, M3/M4/M6/M7/M8, two session-8 minors, and the V1 closeout (covered by §11 Test 15). Migration `build67b-cleanup.sql` applied to prod. Branch: `main` at `<final-sha>`. Build 67b is now fully shipped. Only deferred carry-over is I1 (`xactimate_code` dual-write — keep until 67c retires the column). See [[2026-05-02-build-67b-4]] for cleanup-session handoff.
```

(c) In the "## Open threads" section, delete the long bullet starting with "**67b 52/52 tasks complete + §11 test pass 15/15 PASS — cleanup pass not yet run.**" — that thread is now closed. Replace with one short bullet: "Build 67b: I1 (`xactimate_code` dual-write) deferred until 67c retires the column. No other 67b chips outstanding."

### Step 5.6 — Final verify

- [ ] Run from repo root:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] Run:

```bash
npm run build
```

Expected: ✓ Compiled successfully in ~15-18s with all 119 pages registered.

### Step 5.7 — Commit

- [ ] Stage and commit. Update the chips doc with the actual short SHAs from `git log --oneline -5` first:

```bash
git log --oneline -5
# Edit docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md to substitute
# real SHAs in place of <task1-sha>, <task2-sha>, etc. (Task 5's SHA goes in
# after this commit lands — leave the placeholder for now and fix in the next
# commit if needed.)

git add src/components/estimate-builder/header-bar.tsx \
        src/components/estimate-builder/add-item-dialog.tsx \
        docs/superpowers/specs/2026-05-01-build-67b-cleanup-chips.md \
        docs/vault/00-NOW.md
git commit -m "chore(67b): close session-8 minors, V1 closeout, mark 67b cleanup pass shipped"
```

---

## Self-review checklist (run after the plan's tasks all land)

- [ ] `git log --oneline 06c1bbb..HEAD` shows exactly 5 commits (one per task) with focused messages.
- [ ] `npx tsc --noEmit` from repo root = 0 errors.
- [ ] `npm run build` = ✓ Compiled successfully with all 119 pages.
- [ ] `grep -nE "as any" src/components/estimate-builder/estimate-builder.tsx | wc -l` = noticeably lower than baseline (the polymorphism refactor removed the C4/C5 casts; the template-branch SectionCard cast at the end of Task 3 Step 3.3 may remain as documented).
- [ ] `grep -n "Invoice-mode drag-reorder is a no-op" src/components/estimate-builder/estimate-builder.tsx` returns no hits (Task 2 removed the TODO comment along with the no-op).
- [ ] Chips doc lists each closed chip with a real SHA (no `<task1-sha>` placeholders).
- [ ] 00-NOW.md `last_verified` and "Current build" reflect today's session.

If any checkbox fails, fix it before declaring done.

## Notes for the executor

- **No test framework.** Verification = `tsc` + `npm run build` + manual preview. Do NOT add jest/vitest/playwright unless explicitly asked.
- **Migration apply is manual.** Per project memory, the supabase migration files are not run via `supabase db push`. Apply via Studio SQL editor or the `mcp__31d06679-..._apply_migration` tool.
- **Single-tenant Supabase project.** Dev = prod. Test against AAA org with throwaway estimates only — never against real customer data on settings or invoice rows.
- **Branch.** Work on `main` directly per the existing 67b session pattern. Do NOT use `git push --force` or amend; create new commits.
- **Vercel auto-deploys main.** Per memory, wait for Vercel "Current" badge before suggesting Eric runs an Instant Rollback if anything goes wrong.
- **Polymorphism approach trade-off (Task 3).** This plan chose a "widen with union types" approach over "introduce normalized BuilderSection/BuilderLineItem nominal types." If during execution the union approach proves messy (e.g., narrowing fights inside SectionCard's render), pause and ask before introducing a new abstraction. The acceptable fallback is to revert that file to the `as any` cast and document it as a follow-up chip rather than expanding scope.
