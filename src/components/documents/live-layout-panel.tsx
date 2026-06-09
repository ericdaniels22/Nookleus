"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PdfPreviewFrame } from "@/components/documents/pdf-preview-frame";
import { toast } from "sonner";
import { presetToLayout } from "@/lib/pdf-layout";
import type { DocumentPdfLayout, DocumentType, PdfPreset } from "@/lib/types";

const SAVE_DELAY_MS = 600;

// The boolean show/hide fields of a layout (everything but the title text).
type ToggleKey = Exclude<keyof DocumentPdfLayout, "document_title">;

// The eleven show/hide toggles in panel order. Labels/help mirror the org preset
// editor's vocabulary (settings/pdf-presets) so the two surfaces read the same;
// show_document_title is the document-level field the preset has no column for.
const TOGGLES: { key: ToggleKey; label: string; help?: string }[] = [
  { key: "show_document_title", label: "Show document title" },
  { key: "show_markup", label: "Show markup row in totals" },
  { key: "show_overhead", label: "Show overhead row in totals" },
  { key: "show_profit", label: "Show profit row in totals" },
  { key: "show_discount", label: "Show discount row in totals" },
  { key: "show_tax", label: "Show tax row in totals" },
  { key: "show_opening_statement", label: "Show opening statement" },
  { key: "show_closing_statement", label: "Show closing statement" },
  {
    key: "show_category_subtotals",
    label: "Show per-section subtotals",
    help: "Adds a subtotal row at the end of each section",
  },
  { key: "show_code_column", label: "Show Code column" },
  {
    key: "show_item_notes",
    label: "Show item notes",
    help: "Renders each line item's note as an italic sub-line under the item",
  },
];

// #576 lives on estimates only — #575 kept the invoice's single Markup, so an
// invoice has no overhead/profit amounts and its panel must not offer two inert
// switches. (The fields still ride along in the invoice's layout snapshot; the
// totals block just never reads them there.)
const ESTIMATE_ONLY_TOGGLES: ReadonlySet<ToggleKey> = new Set([
  "show_overhead",
  "show_profit",
]);

interface LayoutControlsProps {
  /**
   * Namespaces every control's `id` so the desktop rail and the mobile sheet —
   * which both render this same control set and can be in the DOM at once (the
   * rail stays mounted under `hidden lg:block` while the sheet is open) — never
   * collide on duplicate ids, keeping each `<Label htmlFor>` pointing at its own
   * input (a11y). The two instances share parent state, so they stay in sync.
   */
  idPrefix: string;
  /** The toggles this document kind offers (estimate-only ones filtered out). */
  toggles: typeof TOGGLES;
  layout: DocumentPdfLayout;
  readOnly: boolean;
  presets: PdfPreset[];
  canManagePresets: boolean;
  naming: boolean;
  presetName: string;
  onApplyPreset: (preset: PdfPreset) => void;
  onTitleChange: (value: string) => void;
  onToggle: (key: ToggleKey) => (checked: boolean) => void;
  onNamingChange: (open: boolean) => void;
  onPresetNameChange: (value: string) => void;
  onSaveAsPreset: () => void;
}

// The controls themselves (preset picker + editable title + the eleven toggles +
// "Save as preset"), with no surrounding chrome. The parent wraps this in a card
// for the desktop rail and in a Sheet for the mobile bottom sheet, so the markup
// lives in exactly one place and both surfaces are driven by the same state.
function LayoutControls({
  idPrefix,
  toggles,
  layout,
  readOnly,
  presets,
  canManagePresets,
  naming,
  presetName,
  onApplyPreset,
  onTitleChange,
  onToggle,
  onNamingChange,
  onPresetNameChange,
  onSaveAsPreset,
}: LayoutControlsProps) {
  return (
    <div className="space-y-4">
      {presets.length > 0 && (
        <div className="border-b border-border pb-3">
          <p className="text-sm font-medium text-foreground mb-2">
            Start from a preset
          </p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={readOnly}
                onClick={() => onApplyPreset(p)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3">
        <div>
          <Label htmlFor={`${idPrefix}document_title`}>Document title</Label>
          <Input
            id={`${idPrefix}document_title`}
            value={layout.document_title}
            maxLength={200}
            disabled={readOnly}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>
        {toggles.map((t) => (
          <div key={t.key} className="flex items-start gap-3">
            <Switch
              id={`${idPrefix}${t.key}`}
              checked={layout[t.key]}
              disabled={readOnly}
              onCheckedChange={onToggle(t.key)}
            />
            <div>
              <Label htmlFor={`${idPrefix}${t.key}`} className="cursor-pointer">
                {t.label}
              </Label>
              {t.help && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.help}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* "Save as preset" — turn the current look into a reusable org preset.
          Gated behind manage_pdf_presets: an edit-only user can change the look
          (and apply presets) but never sees this control (#486). */}
      {canManagePresets && (
        <div className="border-t border-border pt-3">
          {naming ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Preset name"
                placeholder="Preset name"
                value={presetName}
                maxLength={200}
                onChange={(e) => onPresetNameChange(e.target.value)}
              />
              <button
                type="button"
                onClick={onSaveAsPreset}
                disabled={!presetName.trim()}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  onNamingChange(false);
                  onPresetNameChange("");
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNamingChange(true)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              Save as preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface LiveLayoutPanelProps {
  /** Which document kind this panel edits — selects the layout PATCH route. */
  documentType: DocumentType;
  /** The document's id (estimate or invoice). */
  documentId: string;
  previewSrc: string;
  previewTitle: string;
  /** The document's effective layout (server-resolved), so the toggles restore state. */
  layout: DocumentPdfLayout;
  /** Caller holds the matching edit-document permission (edit_estimates / edit_invoices). */
  canEdit: boolean;
  /** The document is frozen (a converted estimate, or a paid/voided invoice) — read-only. */
  locked: boolean;
  /**
   * The Organization's saved presets for this document type (server-prefetched).
   * Each is a one-click starting point: applying one COPIES its choices onto the
   * document's own layout (ADR 0012 snapshot, never a binding link). #486.
   */
  presets?: PdfPreset[];
  /**
   * Caller holds `manage_pdf_presets` — gates the "Save as preset" action. An
   * edit-only user can change the look (and apply presets) but cannot save one.
   */
  canManagePresets?: boolean;
}

// The live PDF layout panel, shared by the Estimate View (#483/#484) and the
// Invoice View (#485). The eleven toggles + editable title autosave the complete
// per-document snapshot (ADR 0012) and re-render the preview live.
//
// Responsive treatment (#488): the preview is the always-mounted main column;
// the controls render twice from one shared state — a `hidden lg:block` right
// rail on a wide screen and a `lg:hidden` bottom Sheet on a narrow one. The
// switch is pure CSS (Tailwind `lg:`), never a JS viewport hook, so there is no
// hydration flash and SSR matches the client. Because the preview lives outside
// the sheet, autosave + the live re-render keep working while the sheet is open.
export function LiveLayoutPanel({
  documentType,
  documentId,
  previewSrc,
  previewTitle,
  layout: initialLayout,
  canEdit,
  locked,
  presets = [],
  canManagePresets = false,
}: LiveLayoutPanelProps) {
  // A frozen document, or a caller without the edit grant, sees the look but
  // cannot change it (ADR 0012 reuses the edit-document boundary + freeze).
  const readOnly = !canEdit || locked;
  const [layout, setLayout] = useState<DocumentPdfLayout>(initialLayout);
  const [version, setVersion] = useState(0);
  // "Save as preset" inline form: closed until the user opts in, then a name box.
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The edit currently waiting on the debounce timer — flushed on teardown so a
  // fast navigate-away inside the window doesn't silently drop it.
  const pending = useRef<DocumentPdfLayout | null>(null);
  // The last look the server actually has (what the preview renders), so a
  // failed save can roll the optimistic switch back to a state that agrees with
  // the preview instead of leaving the two silently desynced.
  const savedLayout = useRef<DocumentPdfLayout>(initialLayout);

  const sendLayout = useCallback(
    (next: DocumentPdfLayout, keepalive = false) =>
      // Estimates and invoices each expose a /api/{type}s/[id]/layout PATCH route
      // (both pluralize with a trailing "s"); the panel is otherwise identical.
      fetch(`/api/${documentType}s/${documentId}/layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        keepalive,
      }),
    [documentType, documentId],
  );

  // Flush the pending edit on unmount instead of merely clearing the timer: the
  // debounce window would otherwise drop the last toggle on a fast navigate-away
  // (easy on a tablet). Mirrors the keepalive flush in use-auto-save.ts (#461).
  // The flush closure rides in a ref so the teardown paths below (unmount +
  // pagehide) always call the freshest one. Rewriting it in a no-dep effect
  // (runs after every commit) keeps `sendLayout` current without writing a ref
  // during render (react-hooks/refs).
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => {
      if (timer.current && pending.current) {
        clearTimeout(timer.current);
        timer.current = null;
        const body = pending.current;
        pending.current = null;
        void sendLayout(body, true);
      }
    };
  });
  useEffect(() => () => flushRef.current(), []);

  // The unmount cleanup above fires only on in-app navigation; a hard teardown
  // (tab close, refresh, address-bar nav, iOS backgrounding) never runs React
  // cleanup, so fire the same keepalive flush from the page-lifecycle event too
  // (#477). beforeunload is intentionally avoided (unreliable in iOS WebKit).
  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Debounced autosave: the panel always persists the *complete* snapshot
  // (ADR 0012), seeded from the effective look with switches flipped. On a
  // successful save, bump the preview version so the iframe re-renders live.
  const save = useCallback(
    (next: DocumentPdfLayout) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        timer.current = null;
        pending.current = null;
        const res = await sendLayout(next);
        // On success, record the persisted look and bump the preview version for
        // a live re-render. On failure, roll the switch back to the last saved
        // look (keeping it in sync with the un-reloaded preview) and surface it.
        if (res.ok) {
          savedLayout.current = next;
          setVersion((v) => v + 1);
        } else {
          const { error } = await res
            .json()
            .catch(() => ({ error: undefined as string | undefined }));
          setLayout(savedLayout.current);
          toast.error(error ?? "Couldn't save layout");
        }
      }, SAVE_DELAY_MS);
    },
    [sendLayout],
  );

  // One generic handler for every switch: flip the field on the complete snapshot
  // and persist the whole thing (ADR 0012), seeded from the effective look.
  const setToggle = (key: ToggleKey) => (checked: boolean) => {
    if (readOnly) return;
    const next = { ...layout, [key]: checked };
    setLayout(next); // optimistic
    save(next);
  };

  // The editable title text rides in the same snapshot as the toggles; an edit
  // funnels through the identical debounced whole-snapshot save.
  const setTitle = (document_title: string) => {
    if (readOnly) return;
    const next = { ...layout, document_title };
    setLayout(next); // optimistic (keeps the input controlled)
    save(next);
  };

  // Apply a preset as a starting point (#486): COPY its choices onto the
  // document's own layout (ADR 0012 snapshot — no binding link, so later edits
  // to the preset never reach this document) and persist the whole snapshot
  // through the identical debounced save. `show_document_title` is preserved from
  // the current look (the preset has no such field).
  const applyPreset = (preset: PdfPreset) => {
    if (readOnly) return;
    const next = presetToLayout(preset, layout.show_document_title);
    setLayout(next); // optimistic
    save(next);
  };

  // Save the document's current look as a new reusable org preset (#486), via the
  // existing POST /api/pdf-presets (gated `manage_pdf_presets` server-side too).
  // `show_document_title` is a document-only field with no preset column, so it is
  // dropped; the ten shared toggles + the title become the preset. This is an
  // explicit action, not debounced.
  const saveAsPreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    const { show_document_title: _omit, ...sharedFields } = layout;
    void _omit;
    const res = await fetch("/api/pdf-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        document_type: documentType,
        ...sharedFields, // document_title + the ten shared toggles
        is_default: false,
      }),
    });
    if (res.ok) {
      toast.success("Preset saved");
      setNaming(false);
      setPresetName("");
    } else {
      const { error } = await res
        .json()
        .catch(() => ({ error: undefined as string | undefined }));
      toast.error(error ?? "Couldn't save preset");
    }
  };

  // version 0 is the untouched server-rendered preview; later versions append a
  // cache-busting param so the preview frame (also keyed on src) re-fetches live.
  const src = version === 0 ? previewSrc : `${previewSrc}?v=${version}`;

  // The shared props both control surfaces (rail + sheet) bind to. They render
  // the same LayoutControls against one parent state, so a toggle in the sheet
  // and the same toggle in the rail are the very same value.
  const controlsProps = {
    toggles:
      documentType === "estimate"
        ? TOGGLES
        : TOGGLES.filter((t) => !ESTIMATE_ONLY_TOGGLES.has(t.key)),
    layout,
    readOnly,
    presets,
    canManagePresets,
    naming,
    presetName,
    onApplyPreset: applyPreset,
    onTitleChange: setTitle,
    onToggle: setToggle,
    onNamingChange: setNaming,
    onPresetNameChange: setPresetName,
    onSaveAsPreset: saveAsPreset,
  };

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      {/* Main column — the live preview (the real #385 document), always mounted
          regardless of breakpoint, so autosave's version bump re-renders it
          whether the controls are a rail or an open sheet. */}
      <div className="lg:min-w-0 lg:flex-1">
        {/* Mobile only (lg:hidden): a trigger that opens the bottom sheet of
            layout options. The preview behind stays visible and live-updates as
            toggles flip inside the sheet. */}
        <div className="mb-3 lg:hidden">
          <Sheet>
            <SheetTrigger
              render={<Button variant="outline" className="w-full" />}
            >
              <SlidersHorizontal />
              Document layout
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh]">
              <SheetHeader>
                <SheetTitle>Document layout</SheetTitle>
                <SheetDescription>
                  Choose what appears on the {documentType}. Changes save and
                  refresh the preview automatically.
                </SheetDescription>
              </SheetHeader>
              {/* pb clears the iOS home-indicator so the last control (Save as
                  preset / final toggle) never lands under the system gesture
                  area — matches the app-wide safe-area idiom (nav, camera-view,
                  review-screen) under the root viewportFit:"cover". */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)]">
                <LayoutControls idPrefix="sheet-" {...controlsProps} />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <PdfPreviewFrame key={src} src={src} title={previewTitle} />
      </div>

      {/* Desktop only (hidden lg:block): the same controls as a sticky right
          rail beside the preview. The Estimate/Invoice Views widen to max-w-6xl
          so the preview column clears the viewer's 640px page-picker threshold
          (#465); the rail stays slim (w-72) to leave the preview that room, which
          at a 1280px viewport with the sidebar open is what tips it over 640. */}
      <aside className="hidden lg:block lg:w-72 lg:shrink-0">
        <div className="rounded-lg border border-border bg-card px-5 py-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <h2 className="text-sm font-medium text-foreground mb-3">
            Document layout
          </h2>
          <LayoutControls idPrefix="rail-" {...controlsProps} />
        </div>
      </aside>
    </div>
  );
}
