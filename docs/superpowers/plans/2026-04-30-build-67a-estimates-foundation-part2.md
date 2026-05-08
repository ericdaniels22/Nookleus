---
date: 2026-04-30
build_id: 67a
plan_part: 2-of-2
related_part: ./2026-04-30-build-67a-estimates-foundation.md
spec: ../specs/2026-04-30-build-67a-estimates-foundation-design.md
build_guide: ~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md
---

# Build 67a Plan — Part 2 (Tasks 10–30)

Continuation of `2026-04-30-build-67a-estimates-foundation.md`. Tasks 1–9
shipped 2026-04-30 (commits `f626ec8` through `4e53cc3` on `main`). This
file picks up at Task 10.

The build guide (section 6.3) defines an 11-step implementation order.
We're partway through step 5 (API routes). Tasks 10–14 finish the API
surface; Tasks 15–30 cover steps 6–11 (UI + integration + final audit).

## Hardening notes — read first

Tasks 7–9 followed a minimalist template that prioritized matching the
spec verbatim. Code review surfaced patterns worth incorporating from
Task 10 onward. **Bake these into every new route from Task 10
forward** — the deferred sweep filed for Tasks 7–9 backports them to
the earlier files.

1. **Wrap `request.json()` in try/catch.** Return 400 on parse failure.
   Bare `await request.json()` produces an unhandled 500 on bad input.
   ```ts
   let body: SomePayload;
   try {
     body = (await request.json()) as SomePayload;
   } catch {
     return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
   }
   ```

2. **Type-check user-supplied IDs at the boundary.**
   ```ts
   if (typeof body.section_id !== "string" || body.section_id.length === 0) {
     return NextResponse.json({ error: "section_id required" }, { status: 400 });
   }
   ```

3. **Cap free-text fields.** `title` ≤ 200, `description` ≤ 2000,
   `void_reason` ≤ 500. Reject with 400 above the cap.

4. **Check `getActiveOrganizationId` for null.**
   ```ts
   const orgId = await getActiveOrganizationId(supabase);
   if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });
   ```

5. **Verify the row exists before mutating.** A PUT/DELETE against a
   non-existent ID returns a clean 404 instead of a generic
   `update().eq("id", id)` no-op success.

6. **Audit user IDs on soft-delete.** If a column like `voided_by`
   exists (added by the deferred Task 8 patch), write `auth.userId`.
   For Tasks 10–14 the relevant columns may not yet exist; if not,
   leave the implementation simple and let the deferred sweep add the
   audit columns + write paths in one pass.

7. **Idempotency on void/deactivate.** Voiding an already-voided
   estimate or deactivating an already-inactive item should no-op
   (return the current row) rather than overwrite audit fields.

The PostgREST `.is(col, uuid)` bug fixed in `4e53cc3` (Task 9) is the
canonical example: `.is()` only accepts `null`/`true`/`false`/`unknown`.
For UUID-or-null fields, branch:

```ts
let q = supabase.from("estimate_sections").select("...").eq("estimate_id", estimateId);
if (parentId) q = q.eq("parent_section_id", parentId);
else q = q.is("parent_section_id", null);
```

## Cross-task dependencies

```
Tasks 10–14 (API routes) — independent, can SDD in any order.

Task 15 (nav) — independent.
Tasks 16–18 (Item Library page) — depend on Tasks 13, 14.
Task 19 (estimate creation entry) — depends on Task 7.
Task 20 (builder shell) — depends on Tasks 7, 8.
Tasks 21–28 (builder components) — depend on Task 20 (the shell wires them).
Task 29 (read-only view) — depends on Task 8.
Task 30 (job-page integration + final audit) — depends on Tasks 19, 29.
```

Execute Tasks 10–14 in one SDD chain (no shared state). Then Tasks
15, 16–18 in any order. Then Task 19. Then Tasks 20→21→…→28 sequentially
because they share the builder state container in Task 20. Tasks 29
and 30 close out.

---

## Task 10: API route — `/api/estimates/[id]/sections/[section_id]`

**Files:**
- Create: `src/app/api/estimates/[id]/sections/[section_id]/route.ts`

**Methods:** PUT (rename), DELETE (cascade + recalc).

**Permission:** `edit_estimates`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { recalculateTotals } from "@/lib/estimates";

interface RouteCtx { params: Promise<{ id: string; section_id: string }> }

interface RenamePayload {
  title?: string;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId, section_id: sectionId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: RenamePayload;
  try {
    body = (await request.json()) as RenamePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const title = body.title.trim();
  if (title.length > 200) {
    return NextResponse.json({ error: "title too long (max 200)" }, { status: 400 });
  }

  // Verify the section belongs to this estimate (defense-in-depth past RLS)
  const { data: existing } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("estimate_sections")
    .update({ title })
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ section: data });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id: estimateId, section_id: sectionId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: existing } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  // Cascade — DB-level FK ON DELETE CASCADE on estimate_sections handles
  // child subsections + estimate_line_items pointing at this section.
  const { error } = await supabase
    .from("estimate_sections")
    .delete()
    .eq("id", sectionId)
    .eq("estimate_id", estimateId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recalc — items just disappeared, subtotal needs to reflect that.
  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify the FK cascade is in place.**

Before SDD'ing this task, the implementer should confirm via
`supabase/migration-build67a-estimates-foundation.sql` that
`estimate_sections.parent_section_id` and `estimate_line_items.section_id`
both have `ON DELETE CASCADE`. If not, the DELETE here will fail with a FK
violation. Per the spec's §5.1 the cascade is in place, but verify before
shipping.

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/estimates/[id]/sections/[section_id]/route.ts"
git commit -m "$(cat <<'EOF'
feat(67a): PUT + DELETE /api/estimates/[id]/sections/[section_id]

PUT renames a section (title only — reorder is on the parent route).
DELETE cascades via FK to subsections + line items, then recalculates
estimate totals. 404 on cross-estimate access; defense-in-depth past
RLS by scoping every query to (id, estimate_id).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: API route — `/api/estimates/[id]/line-items`

**Files:**
- Create: `src/app/api/estimates/[id]/line-items/route.ts`

**Methods:** POST (insert + recalc), PUT (bulk reorder).

**Permission:** `edit_estimates`.

The insert path supports two modes:
- **From library** — pass `library_item_id`; route snapshots
  `description`/`code`/`unit`/`unit_price` from the library row at insert
  time. Subsequent edits to the library row do NOT affect the line item
  (snapshot semantics per spec §10).
- **Custom** — pass the fields directly; `library_item_id = null`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { recalculateTotals } from "@/lib/estimates";
import { round2 } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface CreatePayload {
  section_id: string;
  library_item_id?: string | null;
  description?: string;
  code?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price?: number;
  sort_order?: number;
}

interface ReorderPayload {
  items: Array<{ id: string; section_id: string; sort_order: number }>;
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: CreatePayload;
  try {
    body = (await request.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.section_id !== "string" || !body.section_id) {
    return NextResponse.json({ error: "section_id required" }, { status: 400 });
  }
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
    return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
  }

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  // Verify section belongs to this estimate
  const { data: section } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", body.section_id)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!section) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  // Resolve fields — library snapshot OR custom
  let description: string;
  let code: string | null;
  let unit: string | null;
  let unit_price: number;

  if (body.library_item_id) {
    const { data: lib } = await supabase
      .from("item_library")
      .select("description, code, default_unit, unit_price, is_active")
      .eq("id", body.library_item_id)
      .maybeSingle<{
        description: string;
        code: string | null;
        default_unit: string | null;
        unit_price: number;
        is_active: boolean;
      }>();
    if (!lib) {
      return NextResponse.json({ error: "library item not found" }, { status: 404 });
    }
    if (!lib.is_active) {
      return NextResponse.json({ error: "library item is inactive" }, { status: 400 });
    }
    description = lib.description;
    code = lib.code;
    unit = lib.default_unit;
    unit_price = body.unit_price ?? lib.unit_price; // allow override at add-time
  } else {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return NextResponse.json({ error: "description required for custom items" }, { status: 400 });
    }
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price required for custom items" }, { status: 400 });
    }
    description = body.description.trim();
    if (description.length > 2000) {
      return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
    }
    code = body.code ?? null;
    unit = body.unit ?? null;
    unit_price = body.unit_price;
  }

  // Compute sort_order if not supplied
  let sort_order = body.sort_order;
  if (sort_order === undefined) {
    const { data: max } = await supabase
      .from("estimate_line_items")
      .select("sort_order")
      .eq("section_id", body.section_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    sort_order = (max?.sort_order ?? -1) + 1;
  }

  const total = round2(body.quantity * unit_price);

  const { data, error } = await supabase
    .from("estimate_line_items")
    .insert({
      organization_id: orgId,
      estimate_id: estimateId,
      section_id: body.section_id,
      library_item_id: body.library_item_id ?? null,
      description,
      code,
      quantity: body.quantity,
      unit,
      unit_price,
      total,
      sort_order,
    })
    .select("*")
    .single<EstimateLineItem>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ line_item: data }, { status: 201 });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: ReorderPayload;
  try {
    body = (await request.json()) as ReorderPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  for (const it of body.items) {
    if (typeof it.id !== "string" || typeof it.section_id !== "string" ||
        typeof it.sort_order !== "number") {
      return NextResponse.json({ error: "invalid item shape" }, { status: 400 });
    }
    const { error } = await supabase
      .from("estimate_line_items")
      .update({ section_id: it.section_id, sort_order: it.sort_order })
      .eq("id", it.id)
      .eq("estimate_id", estimateId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sort-only reorder doesn't change quantity * unit_price totals, but
  // section moves COULD if the future per-section subtotal feature ships.
  // No recalc needed today; revisit if subtotals-by-section land.

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/estimates/[id]/line-items/route.ts"
git commit -m "$(cat <<'EOF'
feat(67a): POST + PUT /api/estimates/[id]/line-items

POST inserts a line item — snapshots description/code/unit/unit_price
from item_library when library_item_id is set, otherwise validates the
custom fields. Auto-computes line total + sort_order, then triggers
recalculateTotals on the parent estimate.
PUT bulk-reorders + cross-section moves; no recalc since sort-only
changes don't affect totals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: API route — `/api/estimates/[id]/line-items/[item_id]`

**Files:**
- Create: `src/app/api/estimates/[id]/line-items/[item_id]/route.ts`

**Methods:** PUT (edit + recalc), DELETE (delete + recalc).

**Permission:** `edit_estimates`.

PUT supports editing description, code, quantity, unit, unit_price,
section_id (move). Always recalcs (any of these can change totals or
move the row to a different section, which under future subtotal-by-
section semantics would matter).

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { recalculateTotals } from "@/lib/estimates";
import { round2 } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string; item_id: string }> }

interface UpdatePayload {
  description?: string;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId, item_id: itemId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: UpdatePayload;
  try {
    body = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Existing row — needed for recompute of total when only one of qty
  // or unit_price changes
  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("id, section_id, quantity, unit_price")
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string; section_id: string; quantity: number; unit_price: number }>();
  if (!existing) {
    return NextResponse.json({ error: "line item not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
    }
    if (body.description.length > 2000) {
      return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
    }
    update.description = body.description.trim();
  }
  if (body.code !== undefined) update.code = body.code;
  if (body.unit !== undefined) update.unit = body.unit;
  if (body.section_id !== undefined) {
    if (typeof body.section_id !== "string") {
      return NextResponse.json({ error: "section_id must be a string" }, { status: 400 });
    }
    // Verify target section belongs to same estimate
    const { data: tgt } = await supabase
      .from("estimate_sections")
      .select("id")
      .eq("id", body.section_id)
      .eq("estimate_id", estimateId)
      .maybeSingle<{ id: string }>();
    if (!tgt) {
      return NextResponse.json({ error: "target section not found" }, { status: 404 });
    }
    update.section_id = body.section_id;
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number") {
      return NextResponse.json({ error: "sort_order must be a number" }, { status: 400 });
    }
    update.sort_order = body.sort_order;
  }

  let qtyChanged = false;
  let priceChanged = false;
  if (body.quantity !== undefined) {
    if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
      return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
    }
    update.quantity = body.quantity;
    qtyChanged = true;
  }
  if (body.unit_price !== undefined) {
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
    }
    update.unit_price = body.unit_price;
    priceChanged = true;
  }
  if (qtyChanged || priceChanged) {
    const newQty = qtyChanged ? (body.quantity as number) : existing.quantity;
    const newPrice = priceChanged ? (body.unit_price as number) : existing.unit_price;
    update.total = round2(newQty * newPrice);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("estimate_line_items")
    .update(update)
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .select("*")
    .single<EstimateLineItem>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ line_item: data });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id: estimateId, item_id: itemId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("id")
    .eq("id", itemId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "line item not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("estimate_line_items")
    .delete()
    .eq("id", itemId)
    .eq("estimate_id", estimateId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: tsc**

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/estimates/[id]/line-items/[item_id]/route.ts"
git commit -m "$(cat <<'EOF'
feat(67a): PUT + DELETE /api/estimates/[id]/line-items/[item_id]

PUT edits description/code/qty/unit/unit_price + cross-section move,
recomputes line total locally when qty or unit_price changes, then
triggers full recalculateTotals.
DELETE removes the row + triggers recalc.
Both are 404-clean and validate cross-estimate access.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: API route — `/api/item-library`

**Files:**
- Create: `src/app/api/item-library/route.ts`

**Methods:** GET (list with filters), POST (create).

**Permissions:**
- GET: `view_estimates` OR `view_invoices` (the library is read by both
  builders).
- POST: `manage_item_library`.

The route is a thin wrapper around `src/lib/item-library.ts` (Task 6).
Filters from query string: `search`, `category`, `damage_type`,
`is_active` (default true).

`requirePermission` doesn't have a built-in OR — easiest way is to try
one and fall back to the other. Refactor below uses an inline helper.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listItems, createItem } from "@/lib/item-library";
import type { ItemCategory } from "@/lib/types";

const VALID_CATEGORIES: ItemCategory[] = [
  "labor", "equipment", "materials", "services", "other",
];

async function requireEither(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  keys: string[],
) {
  for (const k of keys) {
    const r = await requirePermission(supabase, k);
    if (r.ok) return r;
  }
  // Last response wins; all keys failed.
  return await requirePermission(supabase, keys[keys.length - 1]);
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireEither(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const categoryRaw = url.searchParams.get("category");
  const damage_type = url.searchParams.get("damage_type") ?? undefined;
  const isActiveRaw = url.searchParams.get("is_active");

  let category: ItemCategory | undefined;
  if (categoryRaw) {
    if (!VALID_CATEGORIES.includes(categoryRaw as ItemCategory)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    category = categoryRaw as ItemCategory;
  }

  let is_active: boolean | undefined;
  if (isActiveRaw !== null) {
    if (isActiveRaw === "true") is_active = true;
    else if (isActiveRaw === "false") is_active = false;
    else return NextResponse.json({ error: "is_active must be true|false" }, { status: 400 });
  } else {
    is_active = true; // default to active-only
  }

  try {
    const items = await listItems({ search, category, damage_type, is_active }, supabase);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

interface CreatePayload {
  name?: string;
  description?: string;
  code?: string | null;
  category?: ItemCategory;
  default_quantity?: number;
  default_unit?: string | null;
  unit_price?: number;
  damage_type_tags?: string[];
  section_tags?: string[];
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  let body: CreatePayload;
  try {
    body = (await request.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Required fields
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (typeof body.description !== "string") {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "valid category required" }, { status: 400 });
  }
  if (typeof body.default_quantity !== "number" || !Number.isFinite(body.default_quantity)) {
    return NextResponse.json({ error: "default_quantity must be a number" }, { status: 400 });
  }
  if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
    return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
  }
  const name = body.name.trim();
  if (name.length > 200) {
    return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
  }
  if (body.description.length > 2000) {
    return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
  }

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  try {
    const item = await createItem(
      {
        name,
        description: body.description,
        code: body.code ?? null,
        category: body.category,
        default_quantity: body.default_quantity,
        default_unit: body.default_unit ?? null,
        unit_price: body.unit_price,
        damage_type_tags: body.damage_type_tags ?? [],
        section_tags: body.section_tags ?? [],
      },
      orgId,
      auth.userId,
      supabase,
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: tsc**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/item-library/route.ts
git commit -m "$(cat <<'EOF'
feat(67a): GET + POST /api/item-library

GET filters by search/category/damage_type/is_active (defaults to
active-only); requires view_estimates OR view_invoices since both
builders read the library.
POST creates an item; requires manage_item_library and validates the
required fields + length caps before delegating to createItem.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: API route — `/api/item-library/[id]`

**Files:**
- Create: `src/app/api/item-library/[id]/route.ts`

**Methods:** GET, PUT, DELETE (soft — sets `is_active=false`).

**Permissions:**
- GET: `view_estimates` OR `view_invoices`.
- PUT, DELETE: `manage_item_library`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getItem, updateItem, deactivateItem } from "@/lib/item-library";
import type { ItemCategory } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

const VALID_CATEGORIES: ItemCategory[] = [
  "labor", "equipment", "materials", "services", "other",
];

async function requireEither(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  keys: string[],
) {
  for (const k of keys) {
    const r = await requirePermission(supabase, k);
    if (r.ok) return r;
  }
  return await requirePermission(supabase, keys[keys.length - 1]);
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requireEither(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const item = await getItem(id, supabase);
  if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });

  return NextResponse.json({ item });
}

interface UpdatePayload {
  name?: string;
  description?: string;
  code?: string | null;
  category?: ItemCategory;
  default_quantity?: number;
  default_unit?: string | null;
  unit_price?: number;
  damage_type_tags?: string[];
  section_tags?: string[];
  is_active?: boolean;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  let body: UpdatePayload;
  try {
    body = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Verify the row exists for a clean 404
  const existing = await getItem(id, supabase);
  if (!existing) return NextResponse.json({ error: "item not found" }, { status: 404 });

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (body.name.length > 200) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    update.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 });
    }
    if (body.description.length > 2000) {
      return NextResponse.json({ error: "description too long" }, { status: 400 });
    }
    update.description = body.description;
  }
  if (body.code !== undefined) update.code = body.code;
  if (body.default_unit !== undefined) update.default_unit = body.default_unit;
  if (body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    update.category = body.category;
  }
  if (body.default_quantity !== undefined) {
    if (typeof body.default_quantity !== "number" || !Number.isFinite(body.default_quantity)) {
      return NextResponse.json({ error: "default_quantity must be a number" }, { status: 400 });
    }
    update.default_quantity = body.default_quantity;
  }
  if (body.unit_price !== undefined) {
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
    }
    update.unit_price = body.unit_price;
  }
  if (body.damage_type_tags !== undefined) {
    if (!Array.isArray(body.damage_type_tags)) {
      return NextResponse.json({ error: "damage_type_tags must be an array" }, { status: 400 });
    }
    update.damage_type_tags = body.damage_type_tags;
  }
  if (body.section_tags !== undefined) {
    if (!Array.isArray(body.section_tags)) {
      return NextResponse.json({ error: "section_tags must be an array" }, { status: 400 });
    }
    update.section_tags = body.section_tags;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json({ error: "is_active must be boolean" }, { status: 400 });
    }
    update.is_active = body.is_active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  try {
    const item = await updateItem(id, update as Parameters<typeof updateItem>[1], supabase);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  const existing = await getItem(id, supabase);
  if (!existing) return NextResponse.json({ error: "item not found" }, { status: 404 });

  if (!existing.is_active) {
    // Idempotent — already deactivated.
    return NextResponse.json({ ok: true, item: existing });
  }

  try {
    await deactivateItem(id, supabase);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: tsc**

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/item-library/[id]/route.ts"
git commit -m "$(cat <<'EOF'
feat(67a): GET / PUT / DELETE /api/item-library/[id]

GET returns one library item; requires view_estimates OR view_invoices.
PUT updates a whitelist of fields with type + length validation; can
toggle is_active (so reactivate is the same path with is_active=true).
DELETE deactivates (soft); idempotent on already-deactivated items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# UI tasks (15–30) — milestone detail

The remaining tasks build the UI surface. Each is detailed below with
files, dependencies, the component contract (props/state/key behaviors),
and verification. **Full file bodies are deferred to per-task SDD prompts**
because UI judgment calls (text strings, exact shadcn primitive choices,
inline-vs-modal trade-offs) benefit from being made at implementation
time rather than locked in a 1700-line plan.

When SDD'ing each task, the implementer subagent should:
1. Read the spec doc § referenced in the task (authoritative behavior)
2. Read the existing reference patterns linked (auto-save, dnd-kit usage)
3. Write the file using shadcn primitives consistent with the rest of
   the codebase
4. Verify with `npx tsc --noEmit` AND `npm run build` (UI tasks
   especially can pass tsc but fail at static-analysis-time)

Common imports across UI tasks:

```ts
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast"; // or sonner — check existing pattern
import { hasPermission } from "@/lib/permissions"; // client-side check helper
```

---

## Task 15: Sidebar nav — Catalog group + Item Library link

**Files:**
- Modify: `src/components/nav.tsx`

**Behavior:**
- Add a new `Catalog` collapsible group in the settings sidebar after
  the existing `Damage Types` group.
- First (and currently only) child: `Item Library` → `/settings/item-library`.
- Use a `Library` or `Boxes` icon from `lucide-react` (consistent with
  existing settings nav iconography).
- Visibility: only show the Catalog group to users with
  `view_estimates` OR `view_invoices` OR `manage_item_library`. Use the
  existing client-side `hasPermission()` pattern.

**Verification:**
- Reload settings page as Admin → Catalog group visible.
- Reload as a user without any of the three permissions → Catalog
  group hidden.
- `npx tsc --noEmit` clean.

**Commit:**
```
feat(67a): add Catalog nav group with Item Library link
```

---

## Task 16: ItemForm component

**Files:**
- Create: `src/components/item-library/item-form.tsx`

**Props:**
```ts
interface ItemFormProps {
  item?: ItemLibraryItem; // undefined = create mode; defined = edit mode
  onSaved: (item: ItemLibraryItem) => void;
  onCancel: () => void;
}
```

**Behavior:**
- Form fields: `name` (required), `description` (required), `code`
  (optional), `category` (Select: labor/equipment/materials/services/other),
  `default_quantity` (number), `default_unit` (text), `unit_price`
  (number, currency-formatted display), `damage_type_tags` (multi-select
  chips), `section_tags` (multi-select chips), `is_active` (toggle —
  edit mode only).
- Submit hits POST `/api/item-library` (create) or PUT
  `/api/item-library/[id]` (edit).
- Surface server-side errors as inline field errors AND a top-of-form
  toast.
- Disable submit while in-flight; show spinner.

**References:**
- Existing form pattern: `src/components/form-builder/inspector.tsx`.
- For damage types: read the existing damage-type list from
  `src/lib/damage-types.ts` (or wherever the canonical list lives —
  search before duplicating).
- Section tags: free-text chips for now; future enhancement could add
  a curated list.

**Verification:**
- Create mode: fill out the form, submit, confirm response 201 + item
  appears in the parent list.
- Edit mode: open with existing item, change `unit_price`, submit,
  confirm PUT lands and totals reflect on next reload.
- Validation: name empty → submit disabled or returns 400.

**Commit:**
```
feat(67a): ItemForm — create/edit form for item_library entries
```

---

## Task 17: ItemTable component

**Files:**
- Create: `src/components/item-library/item-table.tsx`

**Props:**
```ts
interface ItemTableProps {
  items: ItemLibraryItem[];
  onEdit: (item: ItemLibraryItem) => void;
  onToggleActive: (item: ItemLibraryItem) => void;
}
```

**Behavior:**
- Columns: Name, Code, Category, Unit Price, Damage Types (chips),
  Active (toggle), Actions (Edit | Deactivate/Reactivate menu).
- Sort by `name ASC` by default; click header to sort.
- `unit_price` rendered via `formatCurrency(n)` from `@/lib/format`.
- Empty state when `items.length === 0`: "No items yet — add your first
  one."
- Inactive rows shown with reduced opacity + "(Inactive)" tag.

**References:**
- Existing table pattern: `src/components/jobs-table.tsx` or similar
  shadcn DataTable.

**Verification:**
- Render with 0/1/many items.
- Toggle active → API call → row updates.

**Commit:**
```
feat(67a): ItemTable — list view with sort, filter, deactivate UI
```

---

## Task 18: Item Library settings page

**Files:**
- Create: `src/app/settings/item-library/page.tsx`

**Behavior:**
- Server component that:
  1. Verifies `view_estimates` OR `view_invoices` OR `manage_item_library`
     server-side via `requirePermission` (or its server-side equivalent
     in `src/lib/permissions.ts`); redirects to `/` on fail.
  2. Renders client-side `<ItemLibraryClient />` with the org's items
     pre-fetched (server-side fetch from `listItems({}, supabase)`).
- Client component `ItemLibraryClient`:
  - Filter bar: search input + category Select + damage_type Select +
    "Show inactive" toggle.
  - "+ New Item" button (top-right) → opens `<Dialog>` with
    `<ItemForm />` (Task 16).
  - Edit button per row → opens `<Dialog>` with `<ItemForm item={...} />`.
  - On save callback: re-fetch list (or optimistic update + invalidate).
  - Deactivate / reactivate buttons hit DELETE / PUT respectively.

**References:**
- Settings page shell: `src/app/settings/damage-types/page.tsx` (read
  the existing pattern, copy the layout).

**Verification:**
- Empty state visible on first load if no items.
- Create → list updates.
- Edit → row updates.
- Deactivate → row dims.
- Filter by category narrows list.
- Permission denied path: log in as a Crew Member without permissions,
  navigate manually to `/settings/item-library` → redirect to `/`.

**Commit:**
```
feat(67a): /settings/item-library page with table + create/edit modal
```

---

## Task 19: Estimate creation entry — `/jobs/[id]/estimates/new`

**Files:**
- Create: `src/app/jobs/[id]/estimates/new/page.tsx`

**Behavior:**
- Server component that:
  1. `requirePermission(supabase, "create_estimates")`.
  2. Calls POST `/api/estimates` with `{ job_id }` (or directly inserts
     via `createEstimate` helper — but going through the API keeps
     numbering atomic and consistent).
  3. On success: `redirect(\`/estimates/\${estimate.id}/edit\`)`.
  4. On failure: render an error page with a back-to-job link.

The "+ New Estimate" button on the job page (Task 30) navigates here.
Alternative: the button could call the API directly client-side and
push to the editor — but a server-component redirect is cleaner and
avoids exposing the POST to the browser tab's network panel.

**Verification:**
- Click "+ New Estimate" on a job → land on `/estimates/<new>/edit`.
- Two creates in a row → second redirects to a different estimate ID.
- Permission denied → see the error page.

**Commit:**
```
feat(67a): job-scoped estimate creation entry — POST + redirect
```

---

## Task 20: Estimate Builder shell — page + container component

**Files:**
- Create: `src/app/estimates/[id]/edit/page.tsx`
- Create: `src/components/estimate-builder/index.tsx`

**Behavior:**

`/estimates/[id]/edit/page.tsx` (server component):
- `requirePermission(supabase, "edit_estimates")`.
- Fetch `getEstimateWithContents(id, supabase)` and the parent job +
  customer (joined). 404 if estimate missing.
- Pass everything as props to `<EstimateBuilder />`.

`<EstimateBuilder />` (client component) is the central state container:
- Owns the local builder state (the loaded estimate + sections + items
  + dirty flags).
- Owns the auto-save scheduler (Task 28).
- Passes slices of state to child components.
- Renders the layout per spec §9:
  - HeaderBar (Task 21)
  - MetadataBar + CustomerBlock (Task 22)
  - Opening statement editor (Task 23)
  - Sections list (one SectionCard per section, Task 24, w/ subsections + line items inside)
  - Closing statement editor (Task 23)
  - TotalsPanel (sticky bottom-right, Task 27)
- Voided state: render the whole thing read-only with a `VOIDED` badge.

**State shape:**
```ts
interface BuilderState {
  estimate: EstimateWithContents;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  // ... per-field dirty flags as needed
}
```

**References:**
- Form-builder shell: `src/components/form-builder/canvas.tsx` —
  similar centralized client component with auto-save.
- Auto-save hook reference: `src/components/form-builder/use-form-config.ts`.

**Verification:**
- Load `/estimates/<id>/edit` → builder renders with the data.
- Voided estimates render with strikethrough title + read-only state.
- `npm run build` clean (server + client component split must compile).

**Commit:**
```
feat(67a): estimate builder shell — page route + state container
```

---

## Task 21: HeaderBar component

**Files:**
- Create: `src/components/estimate-builder/header-bar.tsx`

**Props:**
```ts
interface HeaderBarProps {
  estimate: Estimate;
  onTitleChange: (title: string) => void;
  onVoid: (reason: string) => void;
  onSend: () => void; // disabled in 67a — placeholder for 67b
  onPdfExport: () => void; // disabled in 67a — placeholder for 67c
  isSaving: boolean;
}
```

**Behavior:**
- Estimate number (monospace pill, per spec §9).
- Editable title (inline edit on click).
- Status badge (color-coded: draft/sent/approved/rejected/converted/voided).
- Action buttons: `Void` (with confirm dialog asking for reason),
  `Send` (disabled with tooltip "Available in 67b"),
  `Export PDF` (disabled with tooltip "Available in 67c").
- SaveIndicator (Task 27) embedded right side.

**Verification:**
- Click title → inline edit appears, saves on blur, debounced via parent.
- Void button opens dialog with required reason field.
- Disabled buttons show tooltip on hover.

**Commit:**
```
feat(67a): HeaderBar — title, status badge, action buttons
```

---

## Task 22: MetadataBar + CustomerBlock

**Files:**
- Create: `src/components/estimate-builder/metadata-bar.tsx`
- Create: `src/components/estimate-builder/customer-block.tsx`

**MetadataBar props:**
```ts
interface MetadataBarProps {
  estimate: Estimate;
  onIssuedDateChange: (d: string | null) => void;
  onValidUntilChange: (d: string | null) => void;
}
```
- Fields: Issued date (date picker), Valid until (date picker, default
  +30 days from issued via `default_estimate_valid_days` setting).
- Layout: horizontal strip below the header.

**CustomerBlock props:**
```ts
interface CustomerBlockProps {
  job: Job; // already loaded by parent
}
```
- Read-only display of customer name + address pulled from the job.
- Click "View customer" link opens the customer page in a new tab.

**Verification:**
- Date pickers update parent state; auto-save fires.
- CustomerBlock renders the joined customer correctly.

**Commit:**
```
feat(67a): MetadataBar + CustomerBlock for the estimate builder
```

---

## Task 23: Opening + Closing statement editors

**Files:**
- Create: `src/components/estimate-builder/statement-editor.tsx` (a
  single component used twice — one for opening, one for closing)

**Props:**
```ts
interface StatementEditorProps {
  label: "Opening statement" | "Closing statement";
  value: string | null;
  onChange: (next: string | null) => void;
  defaultText: string; // resolved from company_settings by parent
}
```

**Behavior:**
- Wrap the existing `<TiptapEditor />` from
  `src/components/tiptap-editor.tsx` (already in use in Build 14e).
- Show a "Reset to default" button when `value !== defaultText`.
- Empty value (null or `""`) renders the default text in italic
  placeholder style.

**References:**
- Tiptap usage: search for `TiptapEditor` in
  `src/components/job-detail.tsx` or settings pages — copy the import.

**Verification:**
- Type into editor → onChange fires → parent state updates → auto-save
  triggers.
- "Reset to default" button restores the company default.

**Commit:**
```
feat(67a): Tiptap-backed statement editor for opening + closing
```

---

## Task 24: SectionCard + SubsectionCard

**Files:**
- Create: `src/components/estimate-builder/section-card.tsx`
- Create: `src/components/estimate-builder/subsection-card.tsx`

**SectionCard props:**
```ts
interface SectionCardProps {
  section: EstimateSection & {
    items: EstimateLineItem[];
    subsections: Array<EstimateSection & { items: EstimateLineItem[] }>;
  };
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void; // confirms first
  onAddSubsection: (parentId: string) => void;
  onAddLineItem: (sectionId: string) => void; // opens AddItemDialog (Task 26)
  onLineItemEdit: (item: EstimateLineItem) => void;
  onLineItemDelete: (id: string) => void;
}
```

**Behavior:**
- Section header: title (inline editable), kebab menu (rename, add
  subsection, delete).
- Children rendered in dnd-kit `<SortableContext>` — line items + nested
  SubsectionCards in mixed order (one shared sort_order space, OR
  separate — see spec §5.1: items are scoped to a `section_id`, which
  is the immediate parent including subsections).
- Drag handle on left edge.
- Delete with confirmation dialog showing item count.

**SubsectionCard:**
- Same shape but no recursive subsections (one-level rule).
- No "Add subsection" option in kebab menu.

**References:**
- dnd-kit sortable: `src/components/form-builder/canvas.tsx` and
  `canvas-section.tsx`.

**Verification:**
- Add 3 sections, drag-reorder them.
- Add a subsection inside section 2.
- Drag the subsection within section 2 (allowed) and try to drag it to
  section 1 (disallowed, snap-back).
- Delete section 1 with 5 items inside → confirm dialog.

**Commit:**
```
feat(67a): SectionCard + SubsectionCard with dnd-kit reorder
```

---

## Task 25: LineItemRow

**Files:**
- Create: `src/components/estimate-builder/line-item-row.tsx`

**Props:**
```ts
interface LineItemRowProps {
  item: EstimateLineItem;
  onChange: (next: Partial<EstimateLineItem>) => void;
  onDelete: () => void;
}
```

**Behavior:**
- Inline-editable cells: description, code, qty, unit, unit_price.
- Computed cell: total (qty × unit_price, formatted).
- Drag handle on left.
- Delete button on right.
- onChange fires on blur (not every keystroke) — auto-save handler in
  parent handles the actual API call.
- Negative values allowed (per spec §10).

**References:**
- Existing line-item editing in `src/components/job-detail.tsx`
  invoices section (if any) — search for inline editing patterns.

**Verification:**
- Edit qty → total recomputes locally → auto-save fires.
- Edit unit_price → same.
- Negative qty → total goes negative without error.

**Commit:**
```
feat(67a): LineItemRow — inline edit with live total + drag handle
```

---

## Task 26: AddItemDialog — library + custom tabs

**Files:**
- Create: `src/components/estimate-builder/add-item-dialog.tsx`

**Props:**
```ts
interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: string;
  sectionId: string;
  jobDamageType?: string; // pre-filter library by this
  onAdded: (item: EstimateLineItem) => void;
}
```

**Behavior:**
- shadcn `<Dialog>` with two tabs: "From Library" (default) and
  "Custom Item".
- **Library tab:**
  - Search input (debounced) + category Select.
  - Default filter: damage_type = job's damage type (if known).
  - Inactive items filtered out.
  - Item list: cards or rows showing name, code, unit_price.
  - Click an item → POST `/api/estimates/[id]/line-items`
    `{ section_id, library_item_id, quantity: lib.default_quantity }`.
  - Multi-add UX: "Add" button per row, dialog stays open; "Done"
    button closes.
- **Custom tab:**
  - Form: description, code, qty, unit, unit_price.
  - "Add" button → POST with library_item_id=null.
  - On success, dialog closes and onAdded fires.

**Verification:**
- Add 3 library items in one dialog session → 3 onAdded calls, dialog
  stays open.
- Custom tab: add an ad-hoc line item.
- Search filter works.
- Inactive items don't appear.

**Commit:**
```
feat(67a): AddItemDialog with Library + Custom tabs
```

---

## Task 27: TotalsPanel + SaveIndicator

**Files:**
- Create: `src/components/estimate-builder/totals-panel.tsx`
- Create: `src/components/estimate-builder/save-indicator.tsx`

**TotalsPanel props:**
```ts
interface TotalsPanelProps {
  estimate: Estimate;
  onMarkupChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
}
```

**Behavior:**
- Sticky positioned bottom-right of the builder area.
- Stack: Subtotal, Markup (with type toggle: % | $ | none), Discount
  (same), Adjusted subtotal, Tax (rate input + computed amount), Total.
- All numbers via `formatCurrency`.
- Tax rate input clamped 0–100 (HTML `min`/`max` + JS guard).
- Negative total → muted warning indicator next to the total.

**SaveIndicator props:**
```ts
interface SaveIndicatorProps {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}
```
- Renders one of:
  - idle: nothing (or "Edited")
  - saving: spinner + "Saving…"
  - saved: checkmark + "Saved at HH:MM"
  - error: ⚠ + "Save failed — retrying"

**Verification:**
- Toggle markup type from % to $ → adjusted_subtotal recomputes.
- Tax rate above 100 → input rejects.
- Force a save error → indicator shows the retry state.

**Commit:**
```
feat(67a): TotalsPanel + SaveIndicator
```

---

## Task 28: Auto-save hook + dnd-kit wiring

**Files:**
- Create: `src/components/estimate-builder/use-auto-save.ts`
- Modify: `src/components/estimate-builder/index.tsx` (Task 20) to wire it in
- Modify: child components as needed for drag handles + sortable contexts

**Auto-save behavior:**
- Debounce field changes by 2000ms (per spec §9).
- Fields → API endpoints:
  - title, opening_statement, closing_statement, issued_date,
    valid_until, markup_*, discount_*, tax_rate, status →
    PUT `/api/estimates/[id]` (single endpoint, partial body).
  - Section reorder → PUT `/api/estimates/[id]/sections`.
  - Section rename / delete → individual section route.
  - Line item edits → individual line-item route.
  - Line item reorder → PUT `/api/estimates/[id]/line-items`.
- On 409 stale: toast "Modified by another user — refresh to see
  changes" and stop further saves until user reloads.
- Exponential backoff on 5xx: 1s → 2s → 4s → 8s, max 30s.
- Indicator state machine: idle → saving → saved (3s) → idle, OR
  saving → error → saving.

**dnd-kit wiring:**
- `<DndContext>` at the builder root.
- `<SortableContext>` per drag scope:
  - Sections (top-level)
  - Subsections within a section
  - Line items within a section/subsection
- `onDragEnd` handlers compute the new sort_order arrays and call the
  appropriate reorder PUT.
- Cross-section drag for line items: disallowed via `closestCenter`
  + section-scoped sortable contexts.
- Subsection drag onto a different parent section: disallowed.

**References:**
- Form-builder dnd: `src/components/form-builder/canvas.tsx`.
- Auto-save: `src/components/form-builder/use-form-config.ts`.

**Verification:**
- Edit title → wait 2s → "Saved at HH:MM" appears.
- Drag a section to position 0 → "Saving…" → "Saved".
- Force a 409 by editing in two tabs → second tab toast appears.
- Network blip during save → "Save failed — retrying" → recovery.

**Commit:**
```
feat(67a): auto-save hook + dnd-kit reorder wiring
```

---

## Task 29: Read-only estimate view — `/estimates/[id]/page.tsx`

**Files:**
- Create: `src/app/estimates/[id]/page.tsx`

**Behavior:**
- Server component that:
  1. `requirePermission(supabase, "view_estimates")`.
  2. Fetch estimate via `getEstimateWithContents`.
  3. Render a basic HTML view (not the builder): header (number, title,
     status, totals), customer block, opening statement, sections list
     with line items, closing statement, totals panel (read-only).
- No edit affordances. "Edit" button (if user has permission) → links
  to `/estimates/[id]/edit`.
- Voided: render strikethrough title + VOIDED badge.

**Note:** PDF generation is a 67c task. This is the in-app preview.

**References:**
- Read-only invoice view (if exists): `src/app/invoices/[id]/page.tsx`
  or similar.

**Verification:**
- Load `/estimates/<id>` → see the read-only render.
- Permission denied: redirect or 403.
- Voided estimate renders correctly.

**Commit:**
```
feat(67a): /estimates/[id] read-only HTML view
```

---

## Task 30: Job-page integration + final audit

**Files:**
- Create: `src/components/job-detail/estimates-invoices-section.tsx`
- Modify: `src/components/job-detail.tsx` (embed the new section)
- Modify: anything else surfaced during the final audit

**EstimatesInvoicesSection props:**
```ts
interface EstimatesInvoicesSectionProps {
  jobId: string;
}
```

**Behavior:**
- Client component.
- Fetch GET `/api/estimates?job_id=<jobId>` on mount.
- Render two stacked cards:
  - "Estimates" — table of estimates: number, title, total, status,
    actions (View, Edit, Void).
  - "Invoices" — placeholder card "Available in 67b" (the lookup
    endpoint exists already; for 67a just stub the empty state).
- "+ New Estimate" button (top-right of Estimates card) →
  `/jobs/[jobId]/estimates/new` (Task 19 server-redirect entry).
- Embed in `src/components/job-detail.tsx` between the existing
  Billing card and any Files section.

**Final audit (do these in order):**

1. **`npm run build`** — must be 0 errors. If anything fails, fix
   before declaring done.
2. **Manual test the full happy path** per spec §11:
   - Item Library: create, edit, deactivate, reactivate, search,
     filter.
   - Numbering: two estimates on one job → EST-1, EST-2.
     Different job → EST-1.
   - Builder: build a multi-section estimate. Drag-and-drop within
     constraints. Auto-save indicator. Totals match server-side.
   - Calculation: subtotal, markup %, markup $, discount %, discount $,
     tax. Verify math.
   - Library snapshot: add library item, edit library row, reload
     estimate — line item price unchanged.
   - Voiding: void estimate → read-only state, badge visible in list.
   - Cross-org RLS: from AAA, attempt API call against TestCo
     estimate ID → 404.
   - Permissions: Crew Member sees but can't create. Crew Lead can
     create/edit but not manage library.
3. **Update `docs/vault/00-NOW.md`** with the 67a completion note.
4. **Update `docs/vault/00-glossary.md`** with any new terms.
5. **Run `/handoff`** to write the closing handoff doc.

**Commit:**
```
feat(67a): job-page integration + Build 67a complete
```

After Task 30, Build 67a is done. The two carry-over follow-ups
already filed (PostgREST .or() injection sweep + 67a-routes hardening
sweep) can be addressed independently in their own short sessions.
67b kicks off separately with its own brainstorm + spec + plan.

---

## Stop / restart checklist

Each SDD chain should kick off with:

1. `git status` — clean working tree, on `main`.
2. `git pull` — confirm no incoming work since the last session.
3. Read `docs/vault/00-NOW.md` for current state.
4. Read this plan file from the task you're starting at.
5. `git rev-parse HEAD` — capture base SHA for the first task's
   review.

Each SDD chain should close with:

1. `git log --oneline <base>..HEAD` — confirm exactly the expected
   commits landed.
2. `npm run build` — must be 0 errors (catches things `tsc --noEmit`
   misses, especially server/client component boundary issues).
3. `/handoff` to capture the session output.

## Tasks 7–9 hardening sweep — embedded checklist

When the deferred hardening chip is run:

- [ ] `src/app/api/estimates/route.ts` (Task 7): JSON parse try/catch;
  validate `body.job_id` is a non-empty string; cap `title.length` at
  200; null check on `getActiveOrganizationId`.
- [ ] `src/app/api/estimates/[id]/route.ts` (Task 8):
  - JSON parse try/catch
  - 404 on missing estimate (PUT and DELETE)
  - Atomic optimistic concurrency: move `updated_at_snapshot` check
    into the UPDATE's WHERE clause (TOCTOU fix)
  - Add `voided_by uuid REFERENCES auth.users(id)` column via a small
    follow-up migration; write `voided_by: auth.userId` in DELETE
  - Idempotency: voiding already-voided estimate returns 200 with
    current row instead of overwriting `voided_at`/`void_reason`
  - Whitelist enforcement on `updateItem`-style direct `update(input)`:
    confirm Task 8 already builds an explicit `update` object (it
    does — leave alone)
- [ ] `src/app/api/estimates/[id]/sections/route.ts` (Task 9):
  - JSON parse try/catch
  - PUT depth validation: call `assertSectionDepth` for each section
    where `parent_section_id !== null`, else allow null
  - Convert PUT bulk-reorder to an atomic RPC
    (`reorder_estimate_sections(p_estimate_id uuid, p_sections jsonb)`)
    so partial failures don't leave inconsistent state
- [ ] PostgREST `.or()` injection (separate chip, addresses
  `src/lib/item-library.ts`, `src/app/api/email/contacts/route.ts`,
  `src/components/job-detail.tsx`): add `escapeOrFilter` helper, use
  `*` wildcards for `ilike`.

The hardening sweep is its own commit (or commit chain) — do not bundle
with feature work.
