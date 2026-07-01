"use client";

// LineItemEditorPanel (#544) — the editor surface for the currently selected
// line. Holds its own draft state for all seven fields and commits on blur
// through the shared change pathway (`onChange`), so auto-save behaves exactly
// as the inline row does. Renders docked on desktop (slides in from the right)
// and as a slide-up sheet on phone, both via tw-animate-css entrance classes.
// Escape closes it from anywhere (window-level), and on phone a tap-dismiss
// scrim sits behind the sheet. (Built up test-first — fields/behaviors per cycle.)

import { useEffect, useRef, useState } from "react";
import { Copy, Ruler, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import ConfirmDialog from "@/components/contracts/confirm-dialog";
import { MoneyInput } from "./money-input";
import {
  deriveEquipmentNote,
  setDays,
  setPieces,
  toEquipmentMode,
  toStandardMode,
} from "./equipment-pricing";
import { SketchSourceBadge } from "./sketch-source-badge";
import {
  ALL_PULL_KINDS,
  ROOM_MEASUREMENT_KIND_LABELS,
  sketchSourceKindLabel,
  type PullKind,
  type RepullPreview,
  type SketchPickerFeed,
  type SketchPullArgs,
} from "@/lib/sketch/pull-resolver";
import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  type ObjectCategory,
} from "@/lib/sketch/object-inventory";
import type { BuilderLineItem } from "./line-item-row";
import type { BuilderMode } from "@/lib/types";

// Tailwind's `lg` breakpoint — the document/editor layout switches from a
// stacked phone sheet to a side-by-side desktop dock at 1024px (matching
// BuilderLayout's `lg:flex-row`).
const DESKTOP_QUERY = "(min-width: 1024px)";

// Shared field chrome — a small label above each control and a consistent input
// look. Kept module-level so they aren't rebuilt every render.
const LABEL_CLASS = "text-xs font-medium text-muted-foreground";
const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-default disabled:opacity-60";

// Tracks whether we're at desktop width via matchMedia. The initial value is
// read synchronously during render (lazy initializer) so the panel never
// flashes the wrong variant; an effect-registered listener keeps it current on
// resize/rotate. setState happens only inside the change callback — never
// synchronously in the effect body — so this stays clear of the repo-wide
// set-state-in-effect lint. jsdom/SSR (no matchMedia) falls back to desktop.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

export interface LineItemEditorPanelProps {
  /** The selected line being edited. */
  item: BuilderLineItem;
  /** Commit a field change — already bound to this line's id by the parent. */
  onChange: (partial: Partial<BuilderLineItem>) => void;
  /** Close the editor (clears selection). */
  onClose: () => void;
  /**
   * Delete the selected line (#630). Optional — callers that omit it (and the
   * isolated field tests) simply render no delete control. Already bound to this
   * line's id by the parent, which runs the optimistic-remove + persist +
   * rollback + toast pathway. After a successful delete the selection clears as
   * the line leaves the live id set, so the panel unmounts itself.
   */
  onDelete?: () => void;
  /**
   * Duplicate the selected line (#683). Optional — callers that omit it render
   * no duplicate control. Already bound to this line's id by the parent, which
   * clones the row (fresh client id, no server identity), drops the copy
   * directly below the original in the same container, persists it
   * (POST-then-reorder for estimate/invoice, local splice for template) and
   * selects the copy so it can be tweaked.
   */
  onDuplicate?: () => void;
  /** Voided / read-only entity — fields render disabled. */
  readOnly?: boolean;
  mode?: BuilderMode;
  /**
   * Load the "Pull from Sketch" picker feed (#861, #865) — the Rooms, each Floor's
   * totals, and the whole-Sketch total of this estimate's job's Sketch, each keyed
   * by pull kind. Optional: when omitted (template/invoice, or an estimate with no
   * Sketch wiring) the pull affordance is not shown. Called lazily when the user
   * opens the picker.
   */
  onLoadSketchSources?: () => Promise<SketchPickerFeed>;
  /**
   * Freeze a Sketch measurement into this line's quantity (#861, #865). The scope
   * chooses the source — a Room, a Floor's total, or the whole Sketch's total.
   * Server-authoritative (the route resolves and persists the frozen value +
   * source); the parent then threads the returned quantity/total/sketch_source
   * back into this item. Optional — its presence (with an editable estimate) is
   * what gates the affordance.
   */
  onPullFromSketch?: (args: SketchPullArgs) => Promise<void>;
  /**
   * Preview a re-pull (#864): re-read this line's frozen source Room from the live
   * Sketch and return `{ old_value, new_value, changed }` so the panel can show
   * old-vs-new before applying. Resolves `null` when the preview failed (the
   * source Room was deleted, or a network error) — the parent surfaces the reason
   * and the panel simply doesn't open the confirm. Optional; its presence
   * (alongside a frozen `sketch_source`) gates the Re-pull affordance.
   */
  onRepullPreview?: () => Promise<RepullPreview | null>;
  /**
   * Apply the confirmed re-pull (#864): recompute + persist the refreshed quantity
   * / source / total, threading the result back into this item. Server-authoritative,
   * like the pull. Receives the `new_value` the user just confirmed so the server
   * can refuse (and the parent surface) a value that drifted since the preview.
   * Optional — paired with {@link onRepullPreview}.
   */
  onRepullApply?: (expectedNewValue: number) => Promise<void>;
}

export function LineItemEditorPanel({
  item,
  onChange,
  onClose,
  onDelete,
  onDuplicate,
  readOnly = false,
  mode,
  onLoadSketchSources,
  onPullFromSketch,
  onRepullPreview,
  onRepullApply,
}: LineItemEditorPanelProps) {
  // Equipment pricing lives on both Estimate (#682) and Invoice (#684) rows, so
  // the shared editor enables it in either builder — but not Template. The `in`
  // check narrows `item` to a row type that carries the equipment fields, so
  // they're type-safe to read.
  const equipmentItem =
    (mode === "estimate" || mode === "invoice") && "pricing_mode" in item
      ? item
      : null;
  const isEquipment = equipmentItem?.pricing_mode === "pieces_days";

  // The frozen Sketch-source breadcrumb (#861) lives only on Estimate rows and
  // only when the quantity was pulled from a Room. The `in` check narrows away
  // the Invoice row type (which carries no sketch_source); a null value means the
  // line was hand-typed and simply shows no badge.
  const sketchSource =
    mode === "estimate" && "sketch_source" in item ? item.sketch_source : null;

  // The pull affordance shows only on an editable Estimate whose builder wired
  // the callbacks (#861). Templates/invoices and voided estimates never opt in.
  const canPull = mode === "estimate" && !readOnly && !!onPullFromSketch;

  // Re-pull (#864) refreshes a frozen source in place. It's Room-scoped: the
  // route re-reads that one Room's live measurement (#865's Floor / whole-Sketch
  // pulls have no in-place re-pull yet — those lines re-pick via "Change source" /
  // "Pull from Sketch"). Narrow once here so the button gate and the confirm
  // dialog both read a Room source, and Floor/Sketch sources fall through to the
  // plain picker instead of a broken Re-pull.
  const repullSource = sketchSource?.scope === "room" ? sketchSource : null;

  // Re-pull is offered only on a Room-sourced line whose builder wired the
  // re-pull callbacks. When available it becomes the primary Sketch action (the
  // fresh-pull picker moves behind a "Change source" secondary), since a sourced
  // line usually wants to refresh its existing source, not re-point it.
  const canRepull =
    canPull && !!repullSource && !!onRepullPreview && !!onRepullApply;

  // Each field holds its own draft, seeded from the item, and commits on blur
  // through `onChange` — mirroring the inline row so auto-save behaves the same.
  const [name, setName] = useState(item.name ?? "");
  const [code, setCode] = useState(item.code ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [note, setNote] = useState(item.note ?? "");
  // Pieces × Days drafts (equipment mode). Empty string when the row carries no
  // value yet; committed on blur through the pure reconcilers.
  const [piecesDraft, setPiecesDraft] = useState(
    equipmentItem?.pieces != null ? String(equipmentItem.pieces) : "",
  );
  const [daysDraft, setDaysDraft] = useState(
    equipmentItem?.days != null ? String(equipmentItem.days) : "",
  );
  // Unit price lives inside MoneyInput, which owns its draft string. The panel
  // keeps a numeric mirror (fed via onValueChange) so the line total can tick
  // live while the user types — exactly as the inline row does.
  const [unitPriceDraft, setUnitPriceDraft] = useState(item.unit_price);

  // Selecting a different line swaps the panel onto it: reseed every draft when
  // the item id changes. Done during render (React's documented "reset all state
  // when a prop changes" pattern) rather than in an effect — synchronous (no
  // flash of the previous line's values) and clear of the set-state-in-effect
  // lint. Same-id field reconciles from the server are owned by MoneyInput's own
  // resync and are intentionally not clobbered mid-edit here.
  const [prevItemId, setPrevItemId] = useState(item.id);
  // Also track the billing mode: toggling Standard ⇄ Pieces × Days reconciles
  // pieces/days/note on the SAME line (id unchanged), so those drafts must
  // reseed on a mode flip too — otherwise the Pieces/Days inputs stay blank
  // from their standard mount seed, and the freed Note keeps the old derived
  // text. Tracked alongside the id reset, never in an effect.
  const [prevMode, setPrevMode] = useState<string | null>(
    equipmentItem?.pricing_mode ?? null,
  );
  const currentMode = equipmentItem?.pricing_mode ?? null;
  if (item.id !== prevItemId) {
    setPrevItemId(item.id);
    setPrevMode(currentMode);
    setName(item.name ?? "");
    setCode(item.code ?? "");
    setQuantity(String(item.quantity));
    setUnit(item.unit ?? "");
    setDescription(item.description ?? "");
    setNote(item.note ?? "");
    setUnitPriceDraft(item.unit_price);
    const swapped =
      (mode === "estimate" || mode === "invoice") && "pricing_mode" in item
        ? item
        : null;
    setPiecesDraft(swapped?.pieces != null ? String(swapped.pieces) : "");
    setDaysDraft(swapped?.days != null ? String(swapped.days) : "");
  } else if (currentMode !== prevMode) {
    // Same line, billing mode toggled — reseed the mode-specific drafts from
    // the reconciled item so the inputs reflect the new values immediately. The
    // Quantity draft is reset too: it's hidden in equipment mode, so an
    // uncommitted edit must not survive the round-trip back to standard.
    setPrevMode(currentMode);
    setQuantity(String(item.quantity));
    setPiecesDraft(equipmentItem?.pieces != null ? String(equipmentItem.pieces) : "");
    setDaysDraft(equipmentItem?.days != null ? String(equipmentItem.days) : "");
    setNote(item.note ?? "");
  }

  const isDesktop = useIsDesktop();

  // #631: the delete button opens a confirmation rather than deleting on the
  // first tap, so an accidental touch can't silently remove work.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // "Pull from Sketch" picker state (#861, #865). The feed (Rooms, each Floor's
  // totals, the whole-Sketch total) is loaded lazily when the picker opens (via
  // onLoadSketchSources); `feed === null` means "not loaded yet". The scope
  // chooses which source the pull freezes — a Room, a Floor's total, or the whole
  // Sketch's total (defaults to Room). Net wall area is the default kind.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [feed, setFeed] = useState<SketchPickerFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [scope, setScope] = useState<SketchPullArgs["scope"]>("room");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("");
  // The kind widens to include `object_count` (#867). When it's the object_count
  // kind, `selectedCategory` names which category the count is scoped by.
  const [selectedKind, setSelectedKind] = useState<PullKind>("wall_area_net");
  const [selectedCategory, setSelectedCategory] =
    useState<ObjectCategory>(OBJECT_CATEGORIES[0]);
  const [pulling, setPulling] = useState(false);

  async function openPicker() {
    setPickerOpen(true);
    if (feed === null && onLoadSketchSources) {
      setFeedLoading(true);
      try {
        const loaded = await onLoadSketchSources();
        setFeed(loaded);
        // Preselect the first Room and Floor so a preview shows immediately when
        // the user switches scope, whichever scope they land on.
        if (loaded.rooms.length > 0) setSelectedRoomId(loaded.rooms[0].id);
        if (loaded.floors.length > 0) setSelectedFloorId(loaded.floors[0].id);
      } finally {
        setFeedLoading(false);
      }
    }
  }

  // The value the picker previews: the selected source's cached measurement for
  // the chosen kind — the same number the server resolves and freezes on Pull.
  // Which source depends on the scope (Room, Floor total, or whole-Sketch total).
  const selectedRoom = feed?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedFloor = feed?.floors.find((floor) => floor.id === selectedFloorId) ?? null;
  // The chosen source (Room, Floor total, or whole-Sketch total) — each carries
  // both its cached measurements and its object inventory, so the preview reads
  // whichever the chosen kind needs: a measurement, or an object_count for the
  // chosen category (#867).
  const selectedSource =
    scope === "room"
      ? selectedRoom
      : scope === "floor"
        ? selectedFloor
        : (feed?.sketch ?? null);
  const pickerPreview =
    selectedSource == null
      ? null
      : selectedKind === "object_count"
        ? selectedSource.objects[selectedCategory]
        : selectedSource.measurements[selectedKind];

  // The Pull button is enabled once its scope has a concrete source: a Room for
  // Room scope, a Floor for Floor scope, and always for whole-Sketch scope.
  const pullReady =
    scope === "room" ? !!selectedRoomId : scope === "floor" ? !!selectedFloorId : true;

  async function confirmPull() {
    if (!onPullFromSketch || !pullReady) return;
    // An object_count pull rides the same scope union but carries the chosen
    // `object_category` so the resolver counts only that category (#867). Every
    // other kind is a measurement and needs no category.
    const kindArgs =
      selectedKind === "object_count"
        ? { kind: selectedKind, object_category: selectedCategory }
        : { kind: selectedKind };
    const args: SketchPullArgs =
      scope === "room"
        ? { scope: "room", roomId: selectedRoomId, ...kindArgs }
        : scope === "floor"
          ? { scope: "floor", floorId: selectedFloorId, ...kindArgs }
          : { scope: "sketch", ...kindArgs };
    setPulling(true);
    try {
      await onPullFromSketch(args);
      setPickerOpen(false);
    } finally {
      setPulling(false);
    }
  }

  // Re-pull flow (#864). Clicking Re-pull runs a dry-run preview; only if it
  // succeeds do we open a confirm showing old-vs-new. A null preview means the
  // source was deleted (or a network error) — the parent has already surfaced the
  // reason, so we open nothing and the frozen quantity is left untouched.
  const [repullOpen, setRepullOpen] = useState(false);
  const [repullPreview, setRepullPreview] = useState<RepullPreview | null>(null);
  const [repullChecking, setRepullChecking] = useState(false);
  const [repullApplying, setRepullApplying] = useState(false);
  // The line a re-pull preview is in flight for. The panel is reused (not
  // remounted) when the selected line changes, so a preview that resolves after
  // the user switched lines must be discarded — otherwise it would open the
  // confirm on the new line with the old line's numbers. Cleared on id-change.
  const repullRequestItemId = useRef<string | null>(null);

  // Reset the whole re-pull flow when the selected line changes (same in-render
  // pattern as the field drafts above, co-located here so all re-pull state is
  // reset in one place): abandon any in-flight preview, close a stale confirm,
  // and un-stick the button. Without this, switching lines mid-flow leaks one
  // line's re-pull onto another.
  const [prevRepullItemId, setPrevRepullItemId] = useState(item.id);
  if (item.id !== prevRepullItemId) {
    setPrevRepullItemId(item.id);
    repullRequestItemId.current = null;
    setRepullOpen(false);
    setRepullPreview(null);
    setRepullChecking(false);
    setRepullApplying(false);
  }

  async function startRepull() {
    if (!onRepullPreview) return;
    const requestedFor = item.id;
    repullRequestItemId.current = requestedFor;
    setRepullChecking(true);
    try {
      const preview = await onRepullPreview();
      // Bail if the user switched lines while the preview was in flight.
      if (repullRequestItemId.current !== requestedFor) return;
      if (preview) {
        setRepullPreview(preview);
        setRepullOpen(true);
      }
    } finally {
      if (repullRequestItemId.current === requestedFor) {
        setRepullChecking(false);
      }
    }
  }

  function cancelRepull() {
    setRepullOpen(false);
    setRepullPreview(null);
  }

  async function confirmRepull() {
    if (!onRepullApply || !repullPreview) return;
    setRepullApplying(true);
    try {
      // Echo the confirmed new value so the server can refuse a drifted one.
      await onRepullApply(repullPreview.new_value);
      setRepullOpen(false);
      setRepullPreview(null);
    } finally {
      setRepullApplying(false);
    }
  }

  // Opening the panel (and swapping to another line) drops the cursor into the
  // name field so the user can type immediately — required for the add-line flow
  // where a blank new line is auto-selected. Focus-only, no state, so it doesn't
  // trip the set-state-in-effect lint.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, [item.id]);

  // Escape closes the editor from anywhere — not only while focus is still
  // inside the panel. A single window-level listener (registered once) covers
  // the case where focus has moved to the document or the totals bar. It bows
  // out when the Escape originates inside a modal dialog layered above the panel
  // (e.g. the Add-item dialog) so it never steals that dialog's own Escape.
  // onClose is read through a ref so the listener is bound once, not re-bound on
  // every keystroke re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"]')) return;
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Live line total — computed from the local editing values. ──────────────
  // In equipment mode the quantity is collapsed pieces × days, so the total
  // ticks off the Pieces/Days drafts; otherwise off the Quantity draft. Both
  // fall back to the committed item when a draft is mid-edit / non-numeric.
  const localQty = Number(quantity);
  const localPieces = Number(piecesDraft);
  const localDays = Number(daysDraft);
  const equipmentDraftsValid =
    piecesDraft.trim() !== "" &&
    daysDraft.trim() !== "" &&
    Number.isFinite(localPieces) &&
    Number.isFinite(localDays);
  const liveTotal = isEquipment
    ? equipmentDraftsValid && Number.isFinite(unitPriceDraft)
      ? localPieces * localDays * unitPriceDraft
      : item.quantity * item.unit_price
    : Number.isFinite(localQty) && Number.isFinite(unitPriceDraft)
      ? localQty * unitPriceDraft
      : item.quantity * item.unit_price;

  // The italic derived note shown under the Pieces/Days row (and persisted to
  // the `note` column for the customer PDF). Ticks live off the drafts.
  const liveDerivedNote = equipmentDraftsValid
    ? deriveEquipmentNote(localPieces, localDays)
    : (equipmentItem?.note ?? "");

  // ── Blur commit helpers — mirror the inline row so auto-save is identical. ──

  function commitName() {
    const trimmed = name.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next !== (item.name ?? null)) {
      onChange({ name: next });
    }
  }

  function commitDescription() {
    const trimmed = description.trim();
    if (!trimmed) {
      // Revert — description is required.
      setDescription(item.description ?? "");
      return;
    }
    if (trimmed !== item.description) {
      onChange({ description: trimmed });
    }
  }

  function commitQuantity() {
    const parsed = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(parsed)) {
      // Revert on empty or NaN.
      setQuantity(String(item.quantity));
      return;
    }
    if (parsed !== item.quantity) {
      onChange({ quantity: parsed });
    }
  }

  function commitCode() {
    const val = code.trim() || null;
    if (val !== item.code) {
      onChange({ code: val });
    }
  }

  function commitUnit() {
    const val = unit.trim() || null;
    if (val !== item.unit) {
      onChange({ unit: val });
    }
  }

  function commitNote() {
    const trimmed = note.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next !== (item.note ?? null)) {
      onChange({ note: next });
    }
  }

  // ── Equipment pricing (#682) ───────────────────────────────────────────────
  // The toggle and the Pieces/Days inputs all route through the pure reconcilers
  // so the pieces × days → quantity + derived-note invariant holds in one place.

  function selectEquipmentMode() {
    if (!equipmentItem || isEquipment) return;
    onChange(toEquipmentMode(equipmentItem) as Partial<BuilderLineItem>);
  }

  function selectStandardMode() {
    if (!equipmentItem || !isEquipment) return;
    onChange(toStandardMode(equipmentItem) as Partial<BuilderLineItem>);
  }

  function commitPieces() {
    if (!equipmentItem) return;
    const parsed = Number(piecesDraft);
    // Revert on empty, non-numeric, or non-positive — equipment rentals are
    // always ≥ 1 piece (mirrors the reconcilers' `> 0` guards).
    if (!piecesDraft.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setPiecesDraft(equipmentItem.pieces != null ? String(equipmentItem.pieces) : "");
      return;
    }
    if (parsed !== equipmentItem.pieces) {
      onChange(setPieces(equipmentItem, parsed) as Partial<BuilderLineItem>);
    }
  }

  function commitDays() {
    if (!equipmentItem) return;
    const parsed = Number(daysDraft);
    // Revert on empty, non-numeric, or non-positive — a rental spans ≥ 1 day.
    if (!daysDraft.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setDaysDraft(equipmentItem.days != null ? String(equipmentItem.days) : "");
      return;
    }
    if (parsed !== equipmentItem.days) {
      onChange(setDays(equipmentItem, parsed) as Partial<BuilderLineItem>);
    }
  }

  return (
    <>
      {!isDesktop && (
        // Phone: a tap-to-dismiss scrim behind the slide-up sheet.
        <div
          data-testid="editor-scrim"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 duration-200"
        />
      )}
      <div
        data-testid="line-item-editor-panel"
        data-variant={isDesktop ? "desktop" : "phone"}
        className={cn(
          "flex flex-col bg-card border-border animate-in fade-in-0 duration-200",
          isDesktop
            ? "sticky top-6 w-full shrink-0 lg:w-[22rem] max-h-[calc(100dvh-3rem)] rounded-xl border shadow-sm slide-in-from-right-4"
            : "fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-2xl border-t shadow-2xl slide-in-from-bottom-8",
        )}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Edit line item
          </h2>
          <button
            type="button"
            aria-label="Close editor"
            onClick={onClose}
            // min-h/min-w-[44px] + centering: on the iPad dock this X is the only
            // visible dismiss control, so it gets a finger-friendly hitbox while the
            // 16px icon stays centered within it (#746).
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body (scrolls if the fields overflow) ───────────────────────── */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block">
            <span className={LABEL_CLASS}>Item name</span>
            <input
              ref={nameRef}
              data-testid="editor-field-name"
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLASS}>Description</span>
            <textarea
              data-testid="editor-field-description"
              value={description}
              disabled={readOnly}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              className={cn(FIELD_CLASS, "resize-none")}
            />
          </label>

          {/* Bill-as toggle (#682) — Estimate builder only. Switches the row
              between a single Quantity and Pieces × Days. */}
          {equipmentItem && (
            <div className="block">
              <span className={LABEL_CLASS}>Bill as</span>
              <div
                data-testid="editor-bill-as"
                role="group"
                aria-label="Bill as"
                className="mt-1 inline-flex rounded-md border border-border p-0.5"
              >
                <button
                  type="button"
                  data-testid="editor-bill-as-standard"
                  aria-pressed={!isEquipment}
                  disabled={readOnly}
                  onClick={selectStandardMode}
                  className={cn(
                    "rounded px-3 py-1 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-60",
                    !isEquipment
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Standard
                </button>
                <button
                  type="button"
                  data-testid="editor-bill-as-equipment"
                  aria-pressed={isEquipment}
                  disabled={readOnly}
                  onClick={selectEquipmentMode}
                  className={cn(
                    "rounded px-3 py-1 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-60",
                    isEquipment
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Pieces × Days
                </button>
              </div>
            </div>
          )}

          {/* The manual Note is hidden in equipment mode — the derived
              "N units for M days" note owns the slot there (#682). */}
          {!isEquipment && (
            <label className="block">
              <span className={LABEL_CLASS}>Note</span>
              <input
                data-testid="editor-field-note"
                value={note}
                disabled={readOnly}
                onChange={(e) => setNote(e.target.value)}
                onBlur={commitNote}
                className={FIELD_CLASS}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={LABEL_CLASS}>Code</span>
              <input
                data-testid="editor-field-code"
                value={code}
                disabled={readOnly}
                onChange={(e) => setCode(e.target.value)}
                onBlur={commitCode}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={LABEL_CLASS}>Unit</span>
              <input
                data-testid="editor-field-unit"
                value={unit}
                disabled={readOnly}
                onChange={(e) => setUnit(e.target.value)}
                onBlur={commitUnit}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {isEquipment ? (
              // Pieces × Days replace the single Quantity input (#682). The
              // collapsed quantity (pieces × days) is derived server-side, so it
              // isn't editable directly here.
              <>
                <label className="block">
                  <span className={LABEL_CLASS}>Pieces</span>
                  <input
                    data-testid="editor-field-pieces"
                    inputMode="numeric"
                    value={piecesDraft}
                    disabled={readOnly}
                    onChange={(e) => setPiecesDraft(e.target.value)}
                    onBlur={commitPieces}
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>Days</span>
                  <input
                    data-testid="editor-field-days"
                    inputMode="numeric"
                    value={daysDraft}
                    disabled={readOnly}
                    onChange={(e) => setDaysDraft(e.target.value)}
                    onBlur={commitDays}
                    className={FIELD_CLASS}
                  />
                </label>
              </>
            ) : (
              <label className="block">
                <span className={LABEL_CLASS}>Quantity</span>
                <input
                  data-testid="editor-field-quantity"
                  value={quantity}
                  disabled={readOnly}
                  onChange={(e) => setQuantity(e.target.value)}
                  onBlur={commitQuantity}
                  className={FIELD_CLASS}
                />
              </label>
            )}
            <label className={cn("block", isEquipment && "col-span-2")}>
              <span className={LABEL_CLASS}>
                {isEquipment ? "Unit cost / piece / day" : "Unit cost"}
              </span>
              <div data-testid="editor-field-unit-cost" className="mt-1">
                <MoneyInput
                  value={item.unit_price}
                  readOnly={readOnly}
                  onValueChange={(raw) => setUnitPriceDraft(Number(raw))}
                  onCommit={(n) => {
                    if (n !== item.unit_price) onChange({ unit_price: n });
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
                />
              </div>
            </label>
          </div>

          {/* Sketch-source badge (#861) — shown when this line's quantity was
              pulled and frozen from a Room, naming the source so the reader knows
              where the billed number came from (acceptance #3). */}
          {sketchSource && (
            <div>
              <SketchSourceBadge source={sketchSource} />
            </div>
          )}

          {/* "Pull from Sketch" affordance (#861) — opens the Room picker that
              freezes a measurement into this line's quantity. Gated on an
              editable estimate whose builder wired the pull callbacks. */}
          {canPull && (
            <div className="space-y-2">
              {canRepull ? (
                // Sourced line: Re-pull the same source is the primary action
                // (#864); re-pointing to a different Room/measurement moves behind
                // a secondary "Change source" that opens the #861 picker.
                <>
                  <button
                    type="button"
                    data-testid="sketch-repull-button"
                    disabled={repullChecking}
                    onClick={startRepull}
                    className="flex min-h-[36px] w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
                  >
                    <Ruler size={16} />
                    {repullChecking ? "Checking Sketch…" : "Re-pull from Sketch"}
                  </button>
                  <button
                    type="button"
                    data-testid="sketch-change-source-button"
                    onClick={openPicker}
                    className="w-full text-center text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  >
                    Change source
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="sketch-pull-button"
                  onClick={openPicker}
                  className="flex min-h-[36px] w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Ruler size={16} />
                  Pull from Sketch
                </button>
              )}

              {pickerOpen && (
                <div
                  data-testid="sketch-picker"
                  className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
                >
                  {feedLoading ? (
                    <p className="text-xs text-muted-foreground">Loading Sketch rooms…</p>
                  ) : feed && feed.floors.length === 0 ? (
                    // No Sketch, or an empty one — a valid state, not an error.
                    <p
                      data-testid="sketch-picker-empty"
                      className="text-xs text-muted-foreground"
                    >
                      No Sketch rooms yet. Draw a Room in the Sketch to pull a
                      measurement from it.
                    </p>
                  ) : feed ? (
                    <>
                      {/* Scope selects the source the pull freezes: a Room, a
                          Floor's total, or the whole-Sketch total (#865). */}
                      <label className="block">
                        <span className={LABEL_CLASS}>Source</span>
                        <select
                          data-testid="sketch-picker-scope"
                          value={scope}
                          onChange={(e) =>
                            setScope(e.target.value as SketchPullArgs["scope"])
                          }
                          className={FIELD_CLASS}
                        >
                          <option value="room">Room</option>
                          <option value="floor">Floor</option>
                          <option value="sketch">Whole Sketch</option>
                        </select>
                      </label>

                      {scope === "room" && (
                        <label className="block">
                          <span className={LABEL_CLASS}>Room</span>
                          <select
                            data-testid="sketch-picker-room"
                            value={selectedRoomId}
                            onChange={(e) => setSelectedRoomId(e.target.value)}
                            className={FIELD_CLASS}
                          >
                            {feed.rooms.map((room) => (
                              <option key={room.id} value={room.id}>
                                {room.floor_name} · {room.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {scope === "floor" && (
                        <label className="block">
                          <span className={LABEL_CLASS}>Floor</span>
                          <select
                            data-testid="sketch-picker-floor"
                            value={selectedFloorId}
                            onChange={(e) => setSelectedFloorId(e.target.value)}
                            className={FIELD_CLASS}
                          >
                            {feed.floors.map((floor) => (
                              <option key={floor.id} value={floor.id}>
                                {floor.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label className="block">
                        <span className={LABEL_CLASS}>Measurement</span>
                        <select
                          data-testid="sketch-picker-kind"
                          value={selectedKind}
                          onChange={(e) =>
                            setSelectedKind(e.target.value as PullKind)
                          }
                          className={FIELD_CLASS}
                        >
                          {ALL_PULL_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {ROOM_MEASUREMENT_KIND_LABELS[kind]}
                            </option>
                          ))}
                          {/* Count of a chosen object category — count-only, never
                              billed as area/length (#867). */}
                          <option value="object_count">Object count</option>
                        </select>
                      </label>

                      {/* The object_count kind is scoped by a category; the picker
                          reveals a category chooser and the preview above switches
                          to that category's inventory count (#867). */}
                      {selectedKind === "object_count" && (
                        <label className="block">
                          <span className={LABEL_CLASS}>Object category</span>
                          <select
                            data-testid="sketch-picker-object-category"
                            value={selectedCategory}
                            onChange={(e) =>
                              setSelectedCategory(e.target.value as ObjectCategory)
                            }
                            className={FIELD_CLASS}
                          >
                            {OBJECT_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {OBJECT_CATEGORY_LABELS[category]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {/* Preview of the value the server will freeze — sourced
                          from the same cached measurement the pull resolver reads,
                          so what's shown is what lands in `quantity`. */}
                      <div className="flex items-center justify-between pt-1">
                        <span className={LABEL_CLASS}>Preview</span>
                        <span
                          data-testid="sketch-picker-preview"
                          className="text-sm font-semibold tabular-nums text-foreground"
                        >
                          {pickerPreview != null ? pickerPreview : "—"}
                        </span>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setPickerOpen(false)}
                          className="flex min-h-[36px] flex-1 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid="sketch-picker-pull"
                          disabled={!pullReady || pulling}
                          onClick={confirmPull}
                          className="flex min-h-[36px] flex-1 items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-60"
                        >
                          {pulling ? "Pulling…" : "Pull"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* Derived note under the row (#682) — mirrors the italic sub-line the
              customer PDF renders from the persisted `note`. */}
          {isEquipment && (
            <p
              data-testid="editor-derived-note"
              className="text-xs italic text-muted-foreground"
            >
              {liveDerivedNote}
            </p>
          )}

          {/* ── Live line total ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className={LABEL_CLASS}>Line total</span>
            <span
              data-testid="editor-line-total"
              className="text-base font-semibold tabular-nums text-foreground"
            >
              {formatCurrency(liveTotal)}
            </span>
          </div>
        </div>

        {/* ── Footer: duplicate (#683) + delete (#630) ──────────────────────
            A pinned (shrink-0) footer outside the scrollable body so these
            actions stay visible in both the desktop dock and the phone slide-up
            sheet. Duplicate sits next to Delete; each is a large finger target
            for touch. Hidden on read-only entities and when neither callback is
            supplied. The #631 confirmation guard sits in front of Delete: a tap
            opens the confirm. Duplicate is non-destructive — no confirm. */}
        {(onDuplicate || onDelete) && !readOnly && (
          <div className="flex shrink-0 gap-2 border-t border-border p-4">
            {onDuplicate && (
              <button
                type="button"
                onClick={() => onDuplicate()}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Copy size={16} />
                Duplicate
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                <Trash2 size={16} />
                Delete line item
              </button>
            )}
          </div>
        )}

        {/* ── Delete confirmation (#631) ──────────────────────────────────
            Rendered INSIDE the panel (not as a detached sibling) so it joins
            the panel's stacking context and paints above it in both the docked
            variant and the z-50 phone slide-up sheet. The fixed-overlay confirm
            still covers the viewport; nesting only governs which layer wins. */}
        <ConfirmDialog
          open={confirmOpen}
          ariaLabel="Delete line item"
          title="Delete line item?"
          body="This removes the line item. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onDelete?.();
          }}
        />

        {/* ── Re-pull confirmation (#864) ─────────────────────────────────
            Shows old-vs-new before the frozen quantity changes — nothing moves
            silently (AC #2). Reuses the blessed confirm modal (focus/inert/Escape
            handling matters when layered over the touch editor) with a primary
            tone, since updating a quantity isn't a destructive action. */}
        {repullSource && (
          <ConfirmDialog
            open={repullOpen}
            ariaLabel="Re-pull from Sketch"
            tone="primary"
            title="Re-pull from Sketch?"
            body={
              <span data-testid="repull-old-vs-new">
                {repullSource.room_name} ·{" "}
                {sketchSourceKindLabel(repullSource)}
                {repullPreview && (
                  <>
                    {" — "}
                    <span className="tabular-nums">{repullPreview.old_value}</span>
                    {" → "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {repullPreview.new_value}
                    </span>
                    {!repullPreview.changed && " (unchanged)"}
                  </>
                )}
              </span>
            }
            confirmLabel={repullApplying ? "Updating…" : "Update quantity"}
            onCancel={cancelRepull}
            onConfirm={confirmRepull}
          />
        )}
      </div>
    </>
  );
}
