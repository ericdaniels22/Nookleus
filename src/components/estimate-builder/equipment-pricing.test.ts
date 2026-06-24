import { describe, it, expect } from "vitest";

import {
  EQUIPMENT_MODE,
  STANDARD_MODE,
  deriveEquipmentNote,
  seedFromLibraryItem,
  setDays,
  setPieces,
  toEquipmentMode,
  toStandardMode,
} from "./equipment-pricing";

describe("deriveEquipmentNote", () => {
  it("renders pieces and days in the plural", () => {
    expect(deriveEquipmentNote(3, 10)).toBe("3 units for 10 days");
  });

  it("uses the singular for a single piece and a single day", () => {
    expect(deriveEquipmentNote(1, 1)).toBe("1 unit for 1 day");
  });

  it("pluralizes pieces and days independently", () => {
    expect(deriveEquipmentNote(1, 10)).toBe("1 unit for 10 days");
    expect(deriveEquipmentNote(3, 1)).toBe("3 units for 1 day");
  });
});

describe("setPieces", () => {
  it("recomputes quantity and the derived note from the new piece count", () => {
    const item = {
      pricing_mode: EQUIPMENT_MODE,
      quantity: 10,
      pieces: 1,
      days: 10,
      note: "1 unit for 10 days",
    };
    expect(setPieces(item, 3)).toEqual({
      pieces: 3,
      quantity: 30,
      note: "3 units for 10 days",
    });
  });
});

describe("setDays", () => {
  it("recomputes quantity and the derived note from the new day count", () => {
    const item = {
      pricing_mode: EQUIPMENT_MODE,
      quantity: 3,
      pieces: 3,
      days: 1,
      note: "3 units for 1 day",
    };
    expect(setDays(item, 10)).toEqual({
      days: 10,
      quantity: 30,
      note: "3 units for 10 days",
    });
  });
});

describe("toEquipmentMode", () => {
  it("seeds pieces from the current quantity over one day, preserving the total", () => {
    const item = {
      pricing_mode: STANDARD_MODE,
      quantity: 3,
      pieces: null,
      days: null,
      note: "manual note",
    };
    expect(toEquipmentMode(item)).toEqual({
      pricing_mode: EQUIPMENT_MODE,
      pieces: 3,
      days: 1,
      quantity: 3,
      note: "3 units for 1 day",
    });
  });

  it("falls back to a single piece when the row has no quantity yet", () => {
    const item = {
      pricing_mode: STANDARD_MODE,
      quantity: 0,
      pieces: null,
      days: null,
      note: "",
    };
    expect(toEquipmentMode(item)).toEqual({
      pricing_mode: EQUIPMENT_MODE,
      pieces: 1,
      days: 1,
      quantity: 1,
      note: "1 unit for 1 day",
    });
  });
});

describe("toStandardMode", () => {
  it("clears pieces and days and releases the note, keeping the quantity", () => {
    const item = {
      pricing_mode: EQUIPMENT_MODE,
      quantity: 30,
      pieces: 3,
      days: 10,
      note: "3 units for 10 days",
    };
    expect(toStandardMode(item)).toEqual({
      pricing_mode: STANDARD_MODE,
      pieces: null,
      days: null,
      note: "",
    });
  });
});

describe("seedFromLibraryItem", () => {
  it("seeds an equipment-category item into equipment mode: default_quantity pieces over one day", () => {
    expect(
      seedFromLibraryItem({ category: "equipment", default_quantity: 3 }),
    ).toEqual({
      pricing_mode: EQUIPMENT_MODE,
      pieces: 3,
      days: 1,
      quantity: 3,
      note: "3 units for 1 day",
    });
  });

  it("falls back to a single piece when the equipment item has no default quantity", () => {
    expect(
      seedFromLibraryItem({ category: "equipment", default_quantity: 0 }),
    ).toEqual({
      pricing_mode: EQUIPMENT_MODE,
      pieces: 1,
      days: 1,
      quantity: 1,
      note: "1 unit for 1 day",
    });
  });

  it("leaves a non-equipment item in standard mode with no pieces or days", () => {
    expect(
      seedFromLibraryItem({ category: "labor", default_quantity: 4 }),
    ).toEqual({
      pricing_mode: STANDARD_MODE,
      pieces: null,
      days: null,
    });
  });
});
