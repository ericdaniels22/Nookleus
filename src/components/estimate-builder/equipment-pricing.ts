// Pure helpers for equipment pricing — the "pieces × days" billing mode.
//
// Equipment is billed by pieces × days (e.g. 3 air movers for 10 days). Per
// the data-model decision in issues #679/#682 the feature is an *input
// affordance plus a derived note*, not a second pricing formula: pieces × days
// collapses into the existing `quantity` (`quantity === pieces × days`), so the
// universal `total = quantity × unit_price` formula and every downstream
// consumer (subtotals, PDF, the estimate→invoice recompute) stay
// equipment-ignorant.
//
// Isolated from React so the invariants can be unit tested in plain Node and
// reused everywhere a row is priced — the estimate/invoice/template builders
// and the server-side line-item routes. Prior art: move-line-item.ts (sibling
// pure helpers). `import type` keeps this a zero-runtime-dependency module.

import type { ItemCategory, PricingMode } from "@/lib/types";

/** Default billing: a single Quantity input, `total = quantity × unit_price`. */
export const STANDARD_MODE = "standard" as const satisfies PricingMode;
/** Equipment billing: Pieces × Days, collapsed into `quantity` (see header). */
export const EQUIPMENT_MODE = "pieces_days" as const satisfies PricingMode;

export type { PricingMode };

/**
 * The slice of a line item the pricing reconcilers read and rewrite. Generic
 * over the concrete builder/row types so the same helpers serve the estimate,
 * invoice, and template builders. Reconcilers return a `Partial` of these
 * fields, shaped to drop straight into an `onChange(partial)` handler.
 */
export interface EquipmentPricingItem {
  pricing_mode: PricingMode;
  quantity: number;
  pieces: number | null;
  days: number | null;
  // The reconcilers only ever *write* the note (a derived string), never read
  // it, so the input may carry a real line item's nullable note unchanged.
  note: string | null;
}

export function deriveEquipmentNote(pieces: number, days: number): string {
  const unit = pieces === 1 ? "unit" : "units";
  const day = days === 1 ? "day" : "days";
  return `${pieces} ${unit} for ${days} ${day}`;
}

/**
 * Reconcile a new piece count: recompute `quantity = pieces × days` and the
 * derived note so the universal total formula keeps holding.
 */
export function setPieces(
  item: EquipmentPricingItem,
  pieces: number,
): Partial<EquipmentPricingItem> {
  const days = item.days ?? 1;
  return {
    pieces,
    quantity: pieces * days,
    note: deriveEquipmentNote(pieces, days),
  };
}

/**
 * Reconcile a new day count: the mirror of {@link setPieces}.
 */
export function setDays(
  item: EquipmentPricingItem,
  days: number,
): Partial<EquipmentPricingItem> {
  const pieces = item.pieces ?? 1;
  return {
    days,
    quantity: pieces * days,
    note: deriveEquipmentNote(pieces, days),
  };
}

/**
 * Switch a row into equipment billing. Seeds Pieces from the current quantity
 * over a single day so the total is preserved across the toggle, and lets the
 * derived note take over the note slot. Falls back to one piece for an empty
 * row so the seed never produces a zero quantity.
 */
export function toEquipmentMode(
  item: EquipmentPricingItem,
): Partial<EquipmentPricingItem> {
  const pieces = item.quantity > 0 ? item.quantity : 1;
  const days = 1;
  return {
    pricing_mode: EQUIPMENT_MODE,
    pieces,
    days,
    quantity: pieces * days,
    note: deriveEquipmentNote(pieces, days),
  };
}

/**
 * Switch a row back to standard billing. Clears the Pieces/Days inputs and
 * releases the note slot back to manual control, but leaves `quantity` (the
 * last pieces × days) intact so the total survives the toggle.
 */
export function toStandardMode(
  _item: EquipmentPricingItem,
): Partial<EquipmentPricingItem> {
  return {
    pricing_mode: STANDARD_MODE,
    pieces: null,
    days: null,
    note: "",
  };
}

/** The slice of a library item the seed reconciler reads. */
export interface LibrarySeedSource {
  category: ItemCategory;
  default_quantity: number;
}

/**
 * Seed a freshly-added line item from the library item it came from. An
 * equipment-category item starts in equipment mode — its default quantity
 * becomes the piece count over a single day (falling back to one piece so the
 * seed is never zero). Every other category stays in standard billing, with no
 * Pieces/Days inputs. Returns only the pricing fields to merge onto the new row.
 */
export function seedFromLibraryItem(
  source: LibrarySeedSource,
): Partial<EquipmentPricingItem> {
  if (source.category !== "equipment") {
    return { pricing_mode: STANDARD_MODE, pieces: null, days: null };
  }
  const pieces = source.default_quantity > 0 ? source.default_quantity : 1;
  const days = 1;
  return {
    pricing_mode: EQUIPMENT_MODE,
    pieces,
    days,
    quantity: pieces * days,
    note: deriveEquipmentNote(pieces, days),
  };
}
