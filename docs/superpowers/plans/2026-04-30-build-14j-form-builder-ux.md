# Build 14j: Intake Form Builder UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current click-to-expand, modal-driven form builder at `/settings/intake-form` with a direct-manipulation, three-column WYSIWYG editor. The form-as-customers-see-it becomes the editor surface. Configuration happens through inline affordances on the field itself and a slide-in inspector drawer. Drag-from-palette adds new fields. Auto-save replaces the manual Save button. A built-in Test mode and a mobile-width toggle let Eric verify the form without leaving the page.

**Architecture:** Three-column layout — left palette (field types + presets), center canvas (live form rendering, click-to-select, drag targets, mobile-width toggle, Edit/Test mode toggle), right inspector drawer (settings for selected field; closed when nothing selected). State stays in a single `FormConfig` React state object as today; auto-save debounces a POST to the existing `/api/settings/intake-form` route. Drag-and-drop via `@dnd-kit/core`. Presets are pure data in a new `src/lib/intake-form-presets.ts`. No database migrations. No backend route changes (auto-save reuses existing POST endpoint). The `intake-form.tsx` component is reused unchanged for Test mode.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons, `@dnd-kit/core` (new dependency), `@dnd-kit/sortable` (new dependency), `@dnd-kit/utilities` (new dependency), Sonner (toast — already in use).

**No test framework:** This project has no jest/vitest/playwright. Verification = `npx tsc --noEmit` + manual preview against `npm run dev`. Every commit should pass tsc.

**Out of scope (explicit non-goals):**

- Conditional logic (`show_when`) — type field exists but UI is deferred to a follow-up build
- Section-level templates ("drop in commercial property block")
- Import/export of form configs
- Database schema changes — `form_config` table and the existing API route are unchanged
- Changes to the public-facing `/intake` form rendering — `IntakeForm` component is reused, not modified
- Per-field validation rules beyond `required`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migration-build14j-prep-form-config-versioning.sql` | Create | Drop singleton `form_config_org_key`, add composite `form_config_org_version_key` on `(organization_id, version)`. Required by Task 0 — without it auto-save 500s on the second save and version history is impossible. |
| `package.json` | Modify | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` dependencies |
| `src/lib/intake-form-presets.ts` | Create | Hardcoded preset library (Phone, Email, US Address, Yes/No, Currency, Date) |
| `src/lib/types.ts` | Modify | Add `FieldPreset` type; everything else unchanged |
| `src/components/form-builder/canvas.tsx` | Create | Center canvas — renders FormConfig as form, click-to-select, drop targets |
| `src/components/form-builder/canvas-section.tsx` | Create | One section with its fields, sortable, with section-level inline affordances |
| `src/components/form-builder/canvas-field.tsx` | Create | Renders one field as it appears on the customer form, with hover affordances |
| `src/components/form-builder/palette.tsx` | Create | Left rail — field types and presets, all draggable |
| `src/components/form-builder/inspector.tsx` | Create | Right drawer — settings for the currently selected field |
| `src/components/form-builder/test-mode.tsx` | Create | Wraps `IntakeForm` with a no-op submit and a "back to edit" button |
| `src/components/form-builder/version-pill.tsx` | Create | Top-bar widget showing save state and version history dropdown |
| `src/components/form-builder/use-form-config.ts` | Create | Custom hook — owns FormConfig state, debounced auto-save, version tracking |
| `src/app/settings/intake-form/page.tsx` | Rewrite | New layout shell. Replaces 483-line single-component implementation |
| `src/app/api/settings/intake-form/versions/route.ts` | Create | GET endpoint — returns last 20 versions of form_config (ordered desc) |
| `src/app/api/settings/intake-form/restore/route.ts` | Create | POST endpoint — accepts `version: number`, restores that version as the new latest |

---

## Key UX Decisions

These decisions are locked in for this build. If you disagree with any, surface it before starting Task 1.

1. **Direct manipulation over modal-driven config.** The form rendered on canvas IS the editor. The current click-section-to-expand model is replaced with always-visible sections and click-to-select fields.
2. **Three-column layout, not single-column.** Left palette (fixed ~240px), center canvas (flex), right inspector (fixed ~320px when open, 0 when closed). Below ~1100px viewport, the inspector becomes a bottom-sheet overlay; below ~768px the palette collapses to a hamburger.
3. **Drag-and-drop replaces up/down arrows.** `@dnd-kit/sortable` for both section reorder and field reorder. Palette items are also draggable into the canvas. Up/down keyboard arrows still work via `@dnd-kit`'s built-in keyboard support — accessibility is preserved.
4. **Inline affordances for the most common toggles.** A "Required" pill on each field is clickable. An eye icon toggles visibility. Hover reveals Duplicate, Delete, and a drag handle.
5. **Auto-save replaces the manual Save button.** Debounced 1500ms after last edit. Top-right pill shows state: `Saved · v12` (idle), `Saving…` (in flight), `Unsaved changes` (debounce window), `Save failed — retry` (error). The pill is a dropdown — clicking it opens version history.
6. **Test mode reuses the public `IntakeForm` component.** Eric clicks `Edit | Test` toggle in the canvas top bar; canvas swaps to `<IntakeForm onSubmit={noop} />`. He fills it in to validate. The config isn't sent anywhere; it's purely local state.
7. **Mobile preview is a width toggle on the canvas, not a device frame.** Toggle between `Desktop (720px)` and `Mobile (390px)`. The canvas constrains its inner width; the rest of the page chrome is unchanged.
8. **Presets are pure data in `src/lib/intake-form-presets.ts`.** Each preset is `{ name, icon, description, makeField: () => Omit<FormField, "id"> }`. Adding new presets in the future means editing one file. No database, no settings UI for managing presets in this build.
9. **Field-type swap preserves shared properties.** Switching a Text field to a Textarea via the inspector keeps `label`, `placeholder`, `help_text`, `required`. Type-specific fields (`options` on select/pill) are dropped only when the new type doesn't support them. This already mostly works in the current builder; the new inspector enforces it explicitly.
10. **Version history is read-only and simple.** Last 20 versions visible in dropdown, each row shows version number + relative time + author (from existing `form_config.created_by`). Clicking a row → confirmation dialog → restores by inserting a new row with the old config (does NOT mutate history). The current `form_config` table already supports this; no schema change required.

---

## Task 0: Schema prep — fix form_config unique index for append-only versioning

**Files:**
- Create: `supabase/migration-build14j-prep-form-config-versioning.sql`

**Why this is here:** the pre-existing unique index `form_config_org_key` on `(organization_id)` (added in [supabase/migration-build46-rework-unique-indexes.sql:104](../../../supabase/migration-build46-rework-unique-indexes.sql)) collapsed each tenant to a single row. That made the *existing* `/api/settings/intake-form` POST handler 500 on the second save (silent latent bug since build46) and made 14j's version-history feature architecturally impossible. The fix swaps it for a composite unique on `(organization_id, version)`, restoring the original 14f append-only history design. The existing POST insert path then works as it was originally written — no route changes needed.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migration-build14j-prep-form-config-versioning.sql` with `drop index if exists form_config_org_key;` followed by `create unique index form_config_org_version_key on public.form_config (organization_id, version);`. Add a header comment explaining purpose, dependency on build46, and revert path.

- [ ] **Step 2: Pre-flight duplicate-detection query**

Run via Supabase MCP `execute_sql` against prod (`rzzprgidqbnqcdupmpfe`):

```sql
select organization_id, version, count(*)
from form_config
group by 1,2
having count(*) > 1;
```

Expected: zero rows. **If this returns any rows, stop and hand back to Eric** — applying the new unique index would fail mid-migration and leave the table in an inconsistent state.

- [ ] **Step 3: Apply via Supabase MCP `apply_migration`**

Migration name: `build14j_prep_form_config_versioning`. Project: `rzzprgidqbnqcdupmpfe`. Apply the same SQL as step 1.

- [ ] **Step 4: Verify the index swap**

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'form_config'
order by indexname;
```

Expected: `form_config_org_version_key` present with `(organization_id, version)`, `form_config_org_key` absent. Other indexes (`form_config_pkey`, `idx_form_config_organization_id`, `idx_form_config_version`) unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-build14j-prep-form-config-versioning.sql
git commit -m "feat(14j): schema prep for append-only form_config versioning

Drop singleton form_config_org_key (one-row-per-org) added in build46.
Add composite form_config_org_version_key on (organization_id, version)
to support the original 14f append-only history design that 14j depends on."
```

---

## Task 1: Install dependencies and create presets module

**Files:**
- Modify: `package.json`
- Create: `src/lib/intake-form-presets.ts`
- Modify: `src/lib/types.ts`

Add the dnd-kit family and stand up the preset data file. No UI changes yet — this task only touches data.

- [ ] **Step 1: Install @dnd-kit packages**

Run from the repo root:

```bash
npm install @dnd-kit/core@^6.1.0 @dnd-kit/sortable@^8.0.0 @dnd-kit/utilities@^3.2.2
```

Expected: three packages added to `package.json` dependencies, no peer dependency warnings.

- [ ] **Step 2: Add `FieldPreset` type to `src/lib/types.ts`**

After the `FormConfig` interface (around line 314), append:

```typescript
export interface FieldPreset {
  /** Unique key for the preset, e.g. "phone", "us_address" */
  key: string;
  /** Display label shown in the palette */
  name: string;
  /** Lucide icon name (kebab-case is fine; component import handled at usage site) */
  icon: string;
  /** One-line description shown on hover/expand */
  description: string;
  /** Builds the FormField that will be inserted when this preset is dragged in. Caller assigns the id. */
  makeField: () => Omit<FormField, "id">;
}
```

- [ ] **Step 3: Create `src/lib/intake-form-presets.ts`**

```typescript
import type { FieldPreset } from "./types";

export const FIELD_PRESETS: FieldPreset[] = [
  {
    key: "phone",
    name: "Phone",
    icon: "Phone",
    description: "Phone number with US format hint",
    makeField: () => ({
      type: "phone",
      label: "Phone",
      placeholder: "(555) 123-4567",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "email",
    name: "Email",
    icon: "Mail",
    description: "Email address",
    makeField: () => ({
      type: "email",
      label: "Email",
      placeholder: "name@example.com",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "us_address",
    name: "US Address",
    icon: "MapPin",
    description: "Single-line text for full street address",
    makeField: () => ({
      type: "text",
      label: "Address",
      placeholder: "123 Main St, Austin, TX 78701",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "yes_no",
    name: "Yes / No",
    icon: "ToggleRight",
    description: "Pill selector with Yes and No options",
    makeField: () => ({
      type: "pill",
      label: "Yes or no?",
      required: false,
      is_default: false,
      visible: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    }),
  },
  {
    key: "currency",
    name: "Currency",
    icon: "DollarSign",
    description: "Number field for dollar amounts",
    makeField: () => ({
      type: "number",
      label: "Amount",
      placeholder: "0.00",
      help_text: "Enter dollar amount",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
  {
    key: "date",
    name: "Date",
    icon: "Calendar",
    description: "Date picker",
    makeField: () => ({
      type: "date",
      label: "Date",
      required: false,
      is_default: false,
      visible: true,
    }),
  },
];
```

- [ ] **Step 4: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no new errors. Pre-existing errors in `jarvis/neural-network` are okay (per project memory).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/intake-form-presets.ts src/lib/types.ts
git commit -m "feat(14j): add @dnd-kit and field preset library

- Install @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- Add FieldPreset type
- Hardcode initial preset library (Phone, Email, US Address, Yes/No, Currency, Date)"
```

---

## Task 2: Create the form-config hook

**Files:**
- Create: `src/components/form-builder/use-form-config.ts`

A custom hook that owns `FormConfig` state, debounced auto-save, version number tracking, and a save-status enum the version pill consumes. Centralizing this logic now means the page component stays thin.

- [ ] **Step 1: Create the hook file**

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FormConfig } from "@/lib/types";

export type SaveStatus =
  | { kind: "idle"; version: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function useFormConfig() {
  const [config, setConfig] = useState<FormConfig>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle", version: 0 });

  // Track the last config we successfully saved so we can avoid no-op POSTs
  const lastSavedRef = useRef<string>("");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/settings/intake-form");
      if (!res.ok) {
        if (!cancelled) {
          setLoading(false);
          toast.error("Failed to load form config");
        }
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      const initial: FormConfig = data.config?.sections
        ? data.config
        : { sections: [] };
      setConfig(initial);
      lastSavedRef.current = JSON.stringify(initial);
      setStatus({ kind: "idle", version: data.version ?? 0 });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: FormConfig) => {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/settings/intake-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      lastSavedRef.current = JSON.stringify(next);
      setStatus({ kind: "idle", version: data.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setStatus({ kind: "error", message });
      toast.error(`Save failed: ${message}`);
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (loading) return;
    const serialized = JSON.stringify(config);
    if (serialized === lastSavedRef.current) {
      // Nothing to save (e.g. the initial load just settled)
      return;
    }
    setStatus({ kind: "dirty" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      save(config);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [config, loading, save]);

  // Manual save (for the "Retry" button or "Save now" affordance)
  const saveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    return save(config);
  }, [config, save]);

  return { config, setConfig, loading, status, saveNow };
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/form-builder/use-form-config.ts
git commit -m "feat(14j): add form-config hook with debounced auto-save"
```

---

## Task 3: Add version history API routes

**Files:**
- Create: `src/app/api/settings/intake-form/versions/route.ts`
- Create: `src/app/api/settings/intake-form/restore/route.ts`

Two thin endpoints. `GET /versions` returns the last 20 rows of `form_config`. `POST /restore` takes a `version` number, fetches that version's `config`, inserts it as a new row, returns the new version number. We never mutate or delete prior rows.

- [ ] **Step 1: Create the versions list endpoint**

Create `src/app/api/settings/intake-form/versions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("form_config")
    .select("version, created_by, created_at")
    .order("version", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ versions: data ?? [] });
}
```

- [ ] **Step 2: Create the restore endpoint**

Create `src/app/api/settings/intake-form/restore/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const targetVersion = Number(body?.version);
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Fetch the config at the target version
  const { data: target, error: fetchErr } = await supabase
    .from("form_config")
    .select("config")
    .eq("version", targetVersion)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Version not found" },
      { status: 404 }
    );
  }

  // Determine the next version number (max + 1)
  const { data: latest, error: latestErr } = await supabase
    .from("form_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  // Insert a new row containing the old config — this preserves history
  const { data: { user } } = await supabase.auth.getUser();
  const createdBy = user?.email ?? "system";

  const { error: insertErr } = await supabase
    .from("form_config")
    .insert({
      version: nextVersion,
      config: target.config,
      created_by: createdBy,
    });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    version: nextVersion,
    config: target.config,
  });
}
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 4: Manual smoke test**

Start the dev server (`npm run dev`) in another terminal, then from the project root:

```bash
curl -s http://localhost:3000/api/settings/intake-form/versions | head -c 500
```

Expected: a JSON object with a `versions` array. (You'll need to be authenticated — if curl doesn't work without auth, just skip and verify in the UI later.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/intake-form/versions/route.ts src/app/api/settings/intake-form/restore/route.ts
git commit -m "feat(14j): version list and restore endpoints for form config"
```

---

## Task 4: Build the Inspector drawer

**Files:**
- Create: `src/components/form-builder/inspector.tsx`

The right-side drawer that shows when a field is selected. Replaces the inline `FieldEditor` from the old builder. Same controls as today — label, type, placeholder, help text, required toggle, options for select/pill — but presented in a consistent panel rather than inserted between rows.

- [ ] **Step 1: Create the inspector component**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { X, Lock } from "lucide-react";
import type { FormField } from "@/lib/types";

const FIELD_TYPES: { value: FormField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "select", label: "Dropdown" },
  { value: "pill", label: "Pill Selector" },
  { value: "checkbox", label: "Checkbox" },
];

export function Inspector({
  field,
  onUpdate,
  onClose,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const isDefault = !!field.is_default;
  const hasOptions = field.type === "select" || field.type === "pill";
  const [newOption, setNewOption] = useState("");

  function addOption() {
    if (!newOption.trim()) return;
    const opts = field.options || [];
    onUpdate({
      options: [
        ...opts,
        {
          value: newOption.trim().toLowerCase().replace(/\s+/g, "_"),
          label: newOption.trim(),
        },
      ],
    });
    setNewOption("");
  }

  function removeOption(index: number) {
    const opts = [...(field.options || [])];
    opts.splice(index, 1);
    onUpdate({ options: opts });
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Field Settings</h3>
          {isDefault && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Lock size={10} /> Built-in field — type and key are locked
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Close inspector"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
          <Input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as FormField["type"] })}
            disabled={isDefault}
            className="w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-50"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {!isDefault && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Changing type preserves label, placeholder, help text, and required status.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Placeholder</label>
          <Input
            value={field.placeholder || ""}
            onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Help Text</label>
          <Input
            value={field.help_text || ""}
            onChange={(e) => onUpdate({ help_text: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={field.required || false}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="w-4 h-4 rounded accent-[var(--brand-primary)]"
          />
          <span className="text-foreground">Required</span>
        </label>

        {hasOptions && !field.options_source && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Options</label>
            <div className="space-y-1">
              {(field.options || []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/40">
                  <span className="text-sm text-foreground flex-1">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{opt.value}</span>
                  {!isDefault && (
                    <button
                      onClick={() => removeOption(i)}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                      aria-label="Remove option"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isDefault && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="New option"
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                />
                <button
                  onClick={addOption}
                  className="px-3 py-1 rounded text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        {field.options_source && (
          <p className="text-xs text-muted-foreground">
            Options loaded dynamically from <span className="font-mono">{field.options_source}</span>
          </p>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/form-builder/inspector.tsx
git commit -m "feat(14j): inspector drawer for selected field settings"
```

---

## Task 5: Build the canvas Field component

**Files:**
- Create: `src/components/form-builder/canvas-field.tsx`

Renders a single field as it appears on the customer-facing form, with hover affordances (drag handle, required toggle pill, visibility eye, duplicate, delete) and a selected state. Click selects.

- [ ] **Step 1: Create the canvas-field component**

```typescript
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, Copy, Trash2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/types";

export function CanvasField({
  field,
  selected,
  onSelect,
  onToggleRequired,
  onToggleVisibility,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  selected: boolean;
  onSelect: () => void;
  onToggleRequired: () => void;
  onToggleVisibility: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, data: { type: "field", fieldId: field.id } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : field.visible === false ? 0.5 : 1,
  };

  const isDefault = !!field.is_default;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg border bg-card px-3 py-2.5 cursor-pointer transition-colors",
        selected
          ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/20"
          : "border-border hover:border-[var(--brand-primary)]/50"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>

        {/* Field preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-sm font-medium text-foreground">{field.label}</label>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleRequired();
              }}
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors",
                field.required
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground/60 opacity-0 group-hover:opacity-100"
              )}
              title={field.required ? "Required (click to make optional)" : "Optional (click to require)"}
            >
              {field.required ? "Required" : "Optional"}
            </button>
            {isDefault && <Lock size={10} className="text-muted-foreground/40" />}
          </div>
          <FieldPreview field={field} />
          {field.help_text && (
            <p className="text-[11px] text-muted-foreground mt-1">{field.help_text}</p>
          )}
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={field.visible === false ? "Show field" : "Hide field"}
          >
            {field.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Duplicate field"
          >
            <Copy size={13} />
          </button>
          {!isDefault && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Delete field"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lightweight visual stand-in matching what the customer-facing form will show. */
function FieldPreview({ field }: { field: FormField }) {
  const baseInput =
    "w-full h-8 rounded-md border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground pointer-events-none";

  switch (field.type) {
    case "textarea":
      return (
        <div className={cn(baseInput, "h-14 py-1.5")}>
          {field.placeholder || "Long text"}
        </div>
      );
    case "select":
      return (
        <div className={cn(baseInput, "flex items-center justify-between")}>
          <span>{field.placeholder || "Select…"}</span>
          <span>▾</span>
        </div>
      );
    case "pill":
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).slice(0, 4).map((opt) => (
            <span
              key={opt.value}
              className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground"
            >
              {opt.label}
            </span>
          ))}
          {(field.options?.length ?? 0) === 0 && (
            <span className="text-[10px] text-muted-foreground italic">No options yet</span>
          )}
        </div>
      );
    case "checkbox":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-3.5 h-3.5 rounded border border-border bg-muted/30" />
          <span>{field.placeholder || "Checkbox"}</span>
        </div>
      );
    case "date":
      return <div className={baseInput}>MM/DD/YYYY</div>;
    case "number":
      return <div className={baseInput}>{field.placeholder || "0"}</div>;
    case "phone":
      return <div className={baseInput}>{field.placeholder || "(555) 123-4567"}</div>;
    case "email":
      return <div className={baseInput}>{field.placeholder || "name@example.com"}</div>;
    default:
      return <div className={baseInput}>{field.placeholder || "Text"}</div>;
  }
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/form-builder/canvas-field.tsx
git commit -m "feat(14j): canvas field component with WYSIWYG preview and hover affordances"
```

---

## Task 6: Build the canvas Section component

**Files:**
- Create: `src/components/form-builder/canvas-section.tsx`

A section card with title, fields, drop zone for new fields, and section-level actions (rename, duplicate, delete, hide). Sections themselves are also draggable. Uses `SortableContext` from `@dnd-kit/sortable` to host the field list.

- [ ] **Step 1: Create canvas-section.tsx**

```typescript
"use client";

import { useState } from "react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, Trash2, Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CanvasField } from "./canvas-field";
import type { FormField, FormSection } from "@/lib/types";

export function CanvasSection({
  section,
  selectedFieldId,
  onSelectField,
  onUpdateSection,
  onToggleSectionVisibility,
  onDeleteSection,
  onUpdateField,
  onDuplicateField,
  onDeleteField,
  onAddBlankField,
}: {
  section: FormSection;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null) => void;
  onUpdateSection: (updates: Partial<FormSection>) => void;
  onToggleSectionVisibility: () => void;
  onDeleteSection: () => void;
  onUpdateField: (fieldId: string, updates: Partial<FormField>) => void;
  onDuplicateField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onAddBlankField: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id, data: { type: "section", sectionId: section.id } });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${section.id}`,
    data: { type: "section-dropzone", sectionId: section.id },
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : section.visible === false ? 0.6 : 1,
  };

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onUpdateSection({ title: trimmed });
    } else {
      setDraftTitle(section.title);
    }
    setEditingTitle(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-card rounded-xl border border-border overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label="Drag section"
        >
          <GripVertical size={16} />
        </button>

        {editingTitle ? (
          <Input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setDraftTitle(section.title);
                setEditingTitle(false);
              }
            }}
            className="h-7 text-sm font-semibold flex-1"
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex-1 text-left"
          >
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            <span className="text-xs text-muted-foreground ml-2">
              {section.fields.filter((f) => f.visible !== false).length} field
              {section.fields.filter((f) => f.visible !== false).length !== 1 ? "s" : ""}
            </span>
          </button>
        )}

        <div className="flex items-center gap-1">
          {section.is_default && <Lock size={12} className="text-muted-foreground/40" />}
          <button
            onClick={onToggleSectionVisibility}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={section.visible === false ? "Show section" : "Hide section"}
          >
            {section.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {!section.is_default && (
            <button
              onClick={onDeleteSection}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Delete section"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <div
        ref={setDropRef}
        className={cn(
          "p-3 space-y-1.5 min-h-[60px] transition-colors",
          isOver && "bg-[var(--brand-primary)]/5"
        )}
      >
        <SortableContext
          items={section.fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {section.fields.map((field) => (
            <CanvasField
              key={field.id}
              field={field}
              selected={selectedFieldId === field.id}
              onSelect={() =>
                onSelectField(selectedFieldId === field.id ? null : field.id)
              }
              onToggleRequired={() =>
                onUpdateField(field.id, { required: !field.required })
              }
              onToggleVisibility={() =>
                onUpdateField(field.id, { visible: field.visible === false })
              }
              onDuplicate={() => onDuplicateField(field.id)}
              onDelete={() => onDeleteField(field.id)}
            />
          ))}
        </SortableContext>

        <button
          onClick={onAddBlankField}
          className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
        >
          <Plus size={14} />
          Add field
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/form-builder/canvas-section.tsx
git commit -m "feat(14j): canvas section component with sortable fields and drop zone"
```

---

## Task 7: Build the Palette

**Files:**
- Create: `src/components/form-builder/palette.tsx`

Left rail with two collapsible groups: Field Types (the nine raw types) and Presets (from the new presets module). Each item is a draggable that, when dropped on a section's drop zone, inserts a new field. Items also support click-to-insert into the currently focused section (or last section if nothing is focused).

- [ ] **Step 1: Create the palette component**

```typescript
"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  Type, AlignLeft, Hash, Calendar, Phone, Mail, ChevronDown,
  CircleDot, CheckSquare, MapPin, ToggleRight, DollarSign,
} from "lucide-react";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormField } from "@/lib/types";

const FIELD_TYPE_ITEMS: {
  type: FormField["type"];
  label: string;
  icon: typeof Type;
}[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "textarea", label: "Text Area", icon: AlignLeft },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "phone", label: "Phone", icon: Phone },
  { type: "email", label: "Email", icon: Mail },
  { type: "select", label: "Dropdown", icon: ChevronDown },
  { type: "pill", label: "Pill Selector", icon: CircleDot },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
];

const PRESET_ICONS = {
  Phone, Mail, MapPin, ToggleRight, DollarSign, Calendar,
} as const;

export function Palette({
  onInsertType,
  onInsertPreset,
}: {
  onInsertType: (type: FormField["type"]) => void;
  onInsertPreset: (presetKey: string) => void;
}) {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Add Field
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Drag onto canvas, or click to add to last section.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <section>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5 px-1">
            Presets
          </h4>
          <div className="space-y-1">
            {FIELD_PRESETS.map((preset) => {
              const Icon =
                (PRESET_ICONS as Record<string, typeof Type>)[preset.icon] ?? Type;
              return (
                <PaletteItem
                  key={preset.key}
                  id={`preset:${preset.key}`}
                  label={preset.name}
                  description={preset.description}
                  icon={Icon}
                  onClick={() => onInsertPreset(preset.key)}
                />
              );
            })}
          </div>
        </section>
        <section>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5 px-1">
            Field Types
          </h4>
          <div className="space-y-1">
            {FIELD_TYPE_ITEMS.map((item) => (
              <PaletteItem
                key={item.type}
                id={`type:${item.type}`}
                label={item.label}
                icon={item.icon}
                onClick={() => onInsertType(item.type)}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function PaletteItem({
  id,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  id: string;
  label: string;
  description?: string;
  icon: typeof Type;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: "palette-item", paletteId: id },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left text-sm border border-transparent hover:border-border hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
      title={description ?? label}
    >
      <Icon size={14} className="mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-foreground truncate">{label}</div>
        {description && (
          <div className="text-[10px] text-muted-foreground truncate">{description}</div>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/form-builder/palette.tsx
git commit -m "feat(14j): palette with field types and presets, draggable + click-to-insert"
```

---

## Task 8: Build the Canvas wrapper, Test mode, and Version pill

**Files:**
- Create: `src/components/form-builder/canvas.tsx`
- Create: `src/components/form-builder/test-mode.tsx`
- Create: `src/components/form-builder/version-pill.tsx`

The canvas wrapper hosts sections and the DndContext for sortable sections. It also owns the Edit/Test toggle and the desktop/mobile width toggle. Test mode wraps the existing `IntakeForm`. The version pill displays save status and a version-history dropdown.

- [ ] **Step 1: Create test-mode.tsx**

```typescript
"use client";

import { ArrowLeft } from "lucide-react";
import IntakeForm from "@/components/intake-form";

export function TestMode({ onExit }: { onExit: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to edit
        </button>
        <span className="text-xs text-muted-foreground">
          Test mode — submissions are not saved
        </span>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <IntakeForm />
      </div>
    </div>
  );
}
```

If `IntakeForm` doesn't accept props (check the existing export signature in `src/components/intake-form.tsx` — current implementation doesn't take an `onSubmit` prop), Test mode just renders it as-is. The "submissions are not saved" line covers the user-visible disclaimer; the form will still try to POST when submitted. **Verify this by reading `src/components/intake-form.tsx` first.** If the form's submit handler hits the real `/api/intake` endpoint, change Test mode to either: (a) wrap `IntakeForm` in a confirmation that intercepts the actual network call (preferred — add a `testMode?: boolean` prop to `intake-form.tsx` that short-circuits submission with `toast.info("Test submission")`), or (b) document that Test mode is preview-only and disable the submit button via a CSS overlay. Choose the approach that matches the actual `IntakeForm` implementation.

- [ ] **Step 2: Read IntakeForm and decide test-mode strategy**

Run: `grep -n "handleSubmit\|onSubmit\|fetch\|/api/" /home/claude/aaa-platform/src/components/intake-form.tsx | head -20` (path adjusted to your local repo).

Based on what you find:
- If `intake-form.tsx` exports a default component with no props and submits to a real endpoint, **add a `testMode?: boolean` prop** that, when true, replaces the real submit with `toast.info("Test submission — not saved")` and returns early.
- Update `test-mode.tsx` above to render `<IntakeForm testMode />`.
- This is the only modification to `intake-form.tsx` in this build. Document the change in the commit.

- [ ] **Step 3: Create version-pill.tsx**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { Check, AlertTriangle, History, Loader2, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import type { SaveStatus } from "./use-form-config";

interface VersionRow {
  version: number;
  created_by: string | null;
  created_at: string;
}

export function VersionPill({
  status,
  onRetry,
  onRestoreSuccess,
}: {
  status: SaveStatus;
  onRetry: () => void;
  onRestoreSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function loadVersions() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/intake-form/versions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch (err) {
      toast.error("Failed to load version history");
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(version: number) {
    if (!confirm(`Restore form to version ${version}? This adds a new version with the old config — nothing is deleted.`)) {
      return;
    }
    try {
      const res = await fetch("/api/settings/intake-form/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Restored from version ${version}`);
      setOpen(false);
      onRestoreSuccess();
    } catch (err) {
      toast.error("Restore failed");
    }
  }

  function StatusBadge() {
    switch (status.kind) {
      case "saving":
        return (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>Saving…</span>
          </>
        );
      case "dirty":
        return <span className="text-muted-foreground">Unsaved changes</span>;
      case "error":
        return (
          <>
            <AlertTriangle size={12} className="text-destructive" />
            <span className="text-destructive">Save failed</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="underline ml-1"
            >
              Retry
            </button>
          </>
        );
      case "idle":
        return (
          <>
            <Check size={12} className="text-emerald-500" />
            <span>Saved · v{status.version}</span>
          </>
        );
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          if (!open) loadVersions();
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card hover:bg-muted/50 transition-colors"
      >
        <StatusBadge />
        <History size={12} className="text-muted-foreground ml-1" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border">
            <h4 className="text-xs font-semibold text-foreground">Version History</h4>
            <p className="text-[11px] text-muted-foreground">
              Last 20 saved versions. Restoring creates a new version.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && (
              <div className="text-center text-xs text-muted-foreground py-4">Loading…</div>
            )}
            {!loading && versions && versions.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-4">No history yet.</div>
            )}
            {!loading &&
              versions?.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">
                      Version {v.version}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                      {v.created_by ? ` · ${v.created_by}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(v.version)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                    title="Restore this version"
                  >
                    <RotateCcw size={11} />
                    Restore
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create canvas.tsx**

```typescript
"use client";

import { useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor,
  KeyboardSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { CanvasSection } from "./canvas-section";
import { TestMode } from "./test-mode";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormConfig, FormField, FormSection } from "@/lib/types";

type ViewMode = "edit" | "test";
type WidthMode = "desktop" | "mobile";

export function Canvas({
  config,
  setConfig,
  selectedFieldId,
  onSelectField,
}: {
  config: FormConfig;
  setConfig: (c: FormConfig) => void;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null) => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [widthMode, setWidthMode] = useState<WidthMode>("desktop");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;

    const activeData = active.data.current as
      | { type: "section" | "field" | "palette-item"; sectionId?: string; fieldId?: string; paletteId?: string }
      | undefined;
    const overData = over.data.current as
      | { type: "section" | "field" | "section-dropzone"; sectionId?: string; fieldId?: string }
      | undefined;

    if (!activeData) return;

    // Sections reordering
    if (activeData.type === "section" && overData?.type === "section") {
      const oldIndex = config.sections.findIndex((s) => s.id === active.id);
      const newIndex = config.sections.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setConfig({ sections: arrayMove(config.sections, oldIndex, newIndex) });
      }
      return;
    }

    // Field reordering — within a section
    if (activeData.type === "field" && overData?.type === "field") {
      const fromSection = config.sections.find((s) =>
        s.fields.some((f) => f.id === active.id)
      );
      const toSection = config.sections.find((s) =>
        s.fields.some((f) => f.id === over.id)
      );
      if (fromSection && toSection && fromSection.id === toSection.id) {
        const oldIndex = fromSection.fields.findIndex((f) => f.id === active.id);
        const newIndex = fromSection.fields.findIndex((f) => f.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          setConfig({
            sections: config.sections.map((s) =>
              s.id === fromSection.id
                ? { ...s, fields: arrayMove(s.fields, oldIndex, newIndex) }
                : s
            ),
          });
        }
      }
      return;
    }

    // Palette item dropped onto a section (or onto a field within a section)
    if (activeData.type === "palette-item") {
      const targetSectionId =
        overData?.type === "section-dropzone"
          ? overData.sectionId
          : overData?.type === "field"
            ? config.sections.find((s) =>
                s.fields.some((f) => f.id === over.id)
              )?.id
            : undefined;
      if (!targetSectionId) return;

      const paletteId = activeData.paletteId ?? "";
      const newField = buildFieldFromPalette(paletteId);
      if (!newField) return;

      setConfig({
        sections: config.sections.map((s) =>
          s.id === targetSectionId ? { ...s, fields: [...s.fields, newField] } : s
        ),
      });
      onSelectField(newField.id);
    }
  }

  function buildFieldFromPalette(paletteId: string): FormField | null {
    const id = "custom_" + Date.now();
    if (paletteId.startsWith("type:")) {
      const type = paletteId.slice("type:".length) as FormField["type"];
      return {
        id,
        type,
        label: "New Field",
        required: false,
        is_default: false,
        visible: true,
      };
    }
    if (paletteId.startsWith("preset:")) {
      const key = paletteId.slice("preset:".length);
      const preset = FIELD_PRESETS.find((p) => p.key === key);
      if (!preset) return null;
      return { id, ...preset.makeField() };
    }
    return null;
  }

  // Section-level handlers
  function updateSection(sectionId: string, updates: Partial<FormSection>) {
    setConfig({
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, ...updates } : s)),
    });
  }
  function deleteSection(sectionId: string) {
    if (!confirm("Delete this section and all its fields?")) return;
    setConfig({ sections: config.sections.filter((s) => s.id !== sectionId) });
  }
  function toggleSectionVisibility(sectionId: string) {
    const section = config.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, { visible: section.visible === false });
  }

  // Field-level handlers
  function updateField(sectionId: string, fieldId: string, updates: Partial<FormField>) {
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === fieldId ? { ...f, ...updates } : f
              ),
            }
          : s
      ),
    });
  }
  function duplicateField(sectionId: string, fieldId: string) {
    const section = config.sections.find((s) => s.id === sectionId);
    const original = section?.fields.find((f) => f.id === fieldId);
    if (!section || !original) return;
    const copy: FormField = {
      ...original,
      id: "custom_" + Date.now(),
      label: original.label + " (copy)",
      is_default: false,
    };
    const idx = section.fields.findIndex((f) => f.id === fieldId);
    const next = [...section.fields];
    next.splice(idx + 1, 0, copy);
    setConfig({
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, fields: next } : s)),
    });
    onSelectField(copy.id);
  }
  function deleteField(sectionId: string, fieldId: string) {
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s
      ),
    });
    if (selectedFieldId === fieldId) onSelectField(null);
  }
  function addBlankField(sectionId: string) {
    const id = "custom_" + Date.now();
    const newField: FormField = {
      id,
      type: "text",
      label: "New Field",
      required: false,
      is_default: false,
      visible: true,
    };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    onSelectField(id);
  }

  if (viewMode === "test") {
    return <TestMode onExit={() => setViewMode("edit")} />;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setViewMode("edit")}
            className={cn(
              "px-3 py-1.5",
              viewMode === "edit" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            Edit
          </button>
          <button
            onClick={() => setViewMode("test")}
            className={cn(
              "px-3 py-1.5 border-l border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            Test
          </button>
        </div>

        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setWidthMode("desktop")}
            className={cn(
              "px-2.5 py-1.5",
              widthMode === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
            aria-label="Desktop preview width"
          >
            <Monitor size={14} />
          </button>
          <button
            onClick={() => setWidthMode("mobile")}
            className={cn(
              "px-2.5 py-1.5 border-l border-border",
              widthMode === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
            aria-label="Mobile preview width"
          >
            <Smartphone size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
        <div
          className={cn(
            "mx-auto transition-[max-width]",
            widthMode === "desktop" ? "max-w-[720px]" : "max-w-[390px]"
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={config.sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {config.sections.map((section) => (
                  <CanvasSection
                    key={section.id}
                    section={section}
                    selectedFieldId={selectedFieldId}
                    onSelectField={onSelectField}
                    onUpdateSection={(updates) => updateSection(section.id, updates)}
                    onToggleSectionVisibility={() => toggleSectionVisibility(section.id)}
                    onDeleteSection={() => deleteSection(section.id)}
                    onUpdateField={(fid, updates) => updateField(section.id, fid, updates)}
                    onDuplicateField={(fid) => duplicateField(section.id, fid)}
                    onDeleteField={(fid) => deleteField(section.id, fid)}
                    onAddBlankField={() => addBlankField(section.id)}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragId ? (
                <div className="rounded-lg border-2 border-[var(--brand-primary)] bg-card px-3 py-2 text-sm shadow-lg">
                  Dragging…
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/form-builder/canvas.tsx src/components/form-builder/test-mode.tsx src/components/form-builder/version-pill.tsx
git commit -m "feat(14j): canvas, test mode, and version pill components"
```

---

## Task 9: Rewrite the page component

**Files:**
- Rewrite: `src/app/settings/intake-form/page.tsx`

Replace the 483-line single-component page with a thin shell that wires up Palette + Canvas + Inspector + VersionPill, owned by the `useFormConfig` hook.

- [ ] **Step 1: Replace the page contents entirely**

Overwrite `src/app/settings/intake-form/page.tsx` with:

```typescript
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Palette } from "@/components/form-builder/palette";
import { Canvas } from "@/components/form-builder/canvas";
import { Inspector } from "@/components/form-builder/inspector";
import { VersionPill } from "@/components/form-builder/version-pill";
import { useFormConfig } from "@/components/form-builder/use-form-config";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormField, FormSection } from "@/lib/types";

export default function IntakeFormBuilderPage() {
  const { config, setConfig, loading, status, saveNow } = useFormConfig();
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  function refresh() {
    // Hard refresh after restore — the simplest correct approach.
    window.location.reload();
  }

  function findField(fieldId: string): { sectionId: string; field: FormField } | null {
    for (const s of config.sections) {
      const f = s.fields.find((x) => x.id === fieldId);
      if (f) return { sectionId: s.id, field: f };
    }
    return null;
  }

  function updateSelectedField(updates: Partial<FormField>) {
    if (!selectedFieldId) return;
    const found = findField(selectedFieldId);
    if (!found) return;
    setConfig({
      sections: config.sections.map((s) =>
        s.id === found.sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === selectedFieldId
                  ? sanitizeFieldForUpdate({ ...f, ...updates })
                  : f
              ),
            }
          : s
      ),
    });
  }

  function addSection() {
    if (!newSectionTitle.trim()) return;
    const id = "custom_" + Date.now();
    const newSection: FormSection = {
      id,
      title: newSectionTitle.trim(),
      is_default: false,
      visible: true,
      fields: [],
    };
    setConfig({ sections: [...config.sections, newSection] });
    setNewSectionTitle("");
    setShowAddSection(false);
  }

  function insertTypeIntoLastSection(type: FormField["type"]) {
    const last = config.sections[config.sections.length - 1];
    if (!last) return;
    const id = "custom_" + Date.now();
    const newField: FormField = {
      id,
      type,
      label: "New Field",
      required: false,
      is_default: false,
      visible: true,
    };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === last.id ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    setSelectedFieldId(id);
  }

  function insertPresetIntoLastSection(presetKey: string) {
    const preset = FIELD_PRESETS.find((p) => p.key === presetKey);
    const last = config.sections[config.sections.length - 1];
    if (!preset || !last) return;
    const id = "custom_" + Date.now();
    const newField: FormField = { id, ...preset.makeField() };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === last.id ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    setSelectedFieldId(id);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading…</div>;
  }

  const selected = selectedFieldId ? findField(selectedFieldId)?.field ?? null : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Intake Form Builder</h2>
          <p className="text-xs text-muted-foreground">
            Drag a field from the left, click to edit. Changes save automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddSection(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-card text-foreground hover:bg-accent transition-colors"
          >
            <Plus size={14} />
            Add section
          </button>
          <VersionPill status={status} onRetry={saveNow} onRestoreSuccess={refresh} />
        </div>
      </header>

      {showAddSection && (
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-end gap-2">
          <div className="flex-1 max-w-md">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Section title</label>
            <Input
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              placeholder="e.g. Equipment Needed"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && addSection()}
            />
          </div>
          <button
            onClick={addSection}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
          >
            Add
          </button>
          <button
            onClick={() => setShowAddSection(false)}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <Palette
          onInsertType={insertTypeIntoLastSection}
          onInsertPreset={insertPresetIntoLastSection}
        />
        <Canvas
          config={config}
          setConfig={setConfig}
          selectedFieldId={selectedFieldId}
          onSelectField={setSelectedFieldId}
        />
        {selected && (
          <Inspector
            field={selected}
            onUpdate={updateSelectedField}
            onClose={() => setSelectedFieldId(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Drop type-incompatible properties when type changes (e.g. clearing options when switching from select to text). */
function sanitizeFieldForUpdate(field: FormField): FormField {
  const supportsOptions = field.type === "select" || field.type === "pill";
  if (!supportsOptions && field.options) {
    const { options, options_source, ...rest } = field;
    return rest as FormField;
  }
  return field;
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: clean. If any old import paths are stale (the old page imported `cn` and `toast`), they're gone now — that's expected.

- [ ] **Step 3: Manual smoke test**

Run `npm run dev` and navigate to `/settings/intake-form`. Verify:

1. Page loads without console errors
2. Existing sections and fields render in the canvas
3. Click a field — the inspector opens on the right
4. Edit the label in the inspector — the canvas updates live
5. Toggle Required in the inspector — the pill on the canvas changes color
6. Hover a field — the drag handle, eye, copy, trash icons appear
7. Drag a "Phone" preset from the left palette into a section — a new field appears and is selected
8. Click "Test" in the canvas top bar — the actual intake form renders
9. Click "Back to edit" — return to canvas
10. Click the desktop/mobile width toggle — canvas width changes
11. Make any change — the version pill shows "Unsaved changes" then "Saving…" then "Saved · v{N+1}"
12. Click the version pill — version history dropdown opens with up to 20 versions

If any of those fail, fix before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/intake-form/page.tsx
git commit -m "refactor(14j): rewrite intake-form page as thin shell over new builder components

Replaces 483-line single-component implementation with composition of
Palette / Canvas / Inspector / VersionPill. Auto-save via useFormConfig hook
replaces the manual Save Form button. Drag-and-drop replaces up/down arrows."
```

---

## Task 10: Apply test-mode changes to IntakeForm

**Files:**
- Modify: `src/components/intake-form.tsx`

Per Task 8 Step 2, decide based on the existing `intake-form.tsx` whether a `testMode` prop is needed.

- [ ] **Step 1: Read intake-form.tsx submission flow**

Run: `grep -nA 5 "handleSubmit\|onSubmit" /home/claude/aaa-platform/src/components/intake-form.tsx | head -40` (path adjusted to your local repo).

- [ ] **Step 2: Add testMode prop if the form submits to a real endpoint**

If `intake-form.tsx` has a submit handler that POSTs to `/api/intake` or similar, add a prop:

```typescript
export default function IntakeForm({ testMode = false }: { testMode?: boolean } = {}) {
  // ...existing code...

  async function handleSubmit(...) {
    if (testMode) {
      toast.info("Test submission — not saved");
      return;
    }
    // ...existing submit logic...
  }
}
```

If the form already takes no props and has internal submit logic, this is a minimal extension — the prop is optional with a `false` default, so callers that don't pass anything are unaffected.

- [ ] **Step 3: Run tsc and dev server**

Run: `npx tsc --noEmit 2>&1 | head -20` — expected clean.

In dev: navigate to `/intake` directly and verify the form still works end-to-end (real submission). Then back to `/settings/intake-form`, click Test, fill the form, submit — confirm the toast appears and no record is created.

- [ ] **Step 4: Commit**

```bash
git add src/components/intake-form.tsx
git commit -m "feat(14j): add testMode prop to IntakeForm for builder preview"
```

---

## Task 11: Final verification & cleanup

**Files:**
- All modified files

- [ ] **Step 1: Full tsc check**

Run: `npx tsc --noEmit 2>&1`

Expected: only the pre-existing 39 errors in `jarvis/neural-network` (per project memory). No new errors. If new errors exist, fix them.

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | tail -40`

Expected: `Compiled successfully`. The route count should match the pre-build baseline plus any new routes from Task 3 (versions, restore).

- [ ] **Step 3: Search for stale references**

```bash
grep -rn "expandedSections\|toggleExpanded\|moveSectionUp\|moveSectionDown\|moveFieldUp\|moveFieldDown\|FieldEditor" src/ --include="*.ts" --include="*.tsx"
```

Expected: no results. These were all part of the old implementation. If any matches, they're dead code from the old builder — remove them.

- [ ] **Step 4: Manual end-to-end walkthrough**

Run `npm run dev` and exercise the builder:

1. Load `/settings/intake-form`. Existing sections present.
2. Add a section "Test Section". It appears at the bottom.
3. Drag the "Phone" preset into Test Section. It appears, gets selected.
4. Edit its label to "Backup phone" in the inspector. Canvas updates immediately.
5. Toggle Required by clicking the pill on the canvas (not the inspector). Pill color changes.
6. Hover over the field, click duplicate. A "Backup phone (copy)" appears below.
7. Drag the "Backup phone (copy)" up two positions. Order persists.
8. Switch to mobile width. Layout adapts. Switch back to desktop.
9. Click Test. The real intake form renders. Fill in name fields, submit. Confirm "Test submission" toast.
10. Click Back to edit.
11. Verify the version pill shows `Saved · v{N}` (where N is at least the original + ~3 changes you've made).
12. Click the version pill. Dropdown shows version history. Restore a prior version. Confirm restore works and page reloads.
13. Verify the restored config matches the older state.
14. Delete the "Test Section". Confirmation prompt appears. Confirm. Section disappears and auto-save triggers.
15. Navigate to `/intake` and verify the customer-facing form reflects the latest builder config (without "Test Section" since you deleted it).

- [ ] **Step 5: Check for accessibility regressions**

Tab through the builder:
- Tab into palette → arrow keys to navigate items → Space/Enter to start drag with `@dnd-kit` keyboard sensor → arrow keys to move → Space to drop
- Tab into a field on canvas → Enter to open inspector → Escape closes inspector
- Tab through inspector controls in a sane order

Expected: every interactive element is reachable by keyboard. Screen reader labels are present (the `aria-label` attributes added in each component).

- [ ] **Step 6: Verify no Supabase advisor regressions**

Use the Supabase MCP `get_advisors` tool with type "security". The two new API routes use `createServerSupabaseClient()` so they inherit existing RLS — no new tables, no new policies, expected zero new findings.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit --allow-empty -m "chore(14j): final verification pass complete"
```

- [ ] **Step 8: Push branch**

```bash
git push -u origin <your-feature-branch>
```

(Branch naming: per repo convention. `14j-form-builder-ux` is fine.)

---

## Verification checklist (must all pass before considering this build done)

- [ ] `form_config` has unique `(organization_id, version)`, not unique `(organization_id)` — Task 0 applied
- [ ] `npx tsc --noEmit` reports no new errors beyond the pre-existing jarvis/neural-network ones
- [ ] `npm run build` succeeds with no new warnings
- [ ] Builder page loads without console errors
- [ ] Drag-and-drop works for both sections and fields, by mouse and by keyboard
- [ ] Click-to-select opens the inspector; click outside or Escape closes it
- [ ] Inline affordances (required pill, eye, duplicate, delete, drag handle) all work on hover
- [ ] Auto-save fires on edit, version pill reflects state correctly, version increments
- [ ] Version history loads and restore works (creates new version, doesn't mutate old ones)
- [ ] Test mode renders the real `IntakeForm` and submission shows a non-saving toast
- [ ] Mobile width toggle constrains canvas; layout responsive below 1100px and 768px
- [ ] Customer-facing `/intake` route is unchanged in behavior (regression-tested by submitting one real intake)
- [ ] No stale references to the old builder (search clean)
- [ ] No new Supabase security advisor findings

---

## Rollback plan

If a regression ships and Eric needs to revert quickly:

```bash
git revert <merge-commit-sha>
git push origin main
# Vercel auto-deploys the revert
```

The database is untouched (no migrations), so revert is purely a code rollback. The `form_config` versions written during the build period are still readable by an older client — versions are just JSON snapshots, and the schema didn't change.

---

## Open follow-ups (not in scope for this build)

- Conditional logic UI (`show_when` already exists on `FormField` type)
- Multi-select drag (move 3 fields at once)
- Section templates ("commercial property" preset bundle)
- Per-organization preset library stored in Supabase rather than hardcoded
- Diff viewer in version history ("what changed in v15 vs v14")
- Undo/redo within the editor session
- Field validation rules (regex, min/max length, etc.) beyond `required`
- Conditional sections (entire section shows only when X)

---

*End of Build 14j Implementation Plan*
