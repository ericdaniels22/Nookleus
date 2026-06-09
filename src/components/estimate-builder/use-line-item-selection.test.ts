// Unit tests for useLineItemSelection (#544) — the line-selection controller
// behind the Estimate Builder's editor panel. Selection is derived in part from
// the live set of line-item ids so the hook can auto-select a freshly added line
// and auto-clear when the selected line is deleted, without the consumer wiring
// those transitions by hand.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLineItemSelection } from "./use-line-item-selection";

describe("useLineItemSelection", () => {
  it("selects a line and reports it via selectedId / isSelected", () => {
    const { result } = renderHook(() => useLineItemSelection(["a", "b"]));

    expect(result.current.selectedId).toBeNull();
    expect(result.current.isSelected("a")).toBe(false);

    act(() => result.current.select("a"));

    expect(result.current.selectedId).toBe("a");
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(false);
  });

  it("clear() deselects", () => {
    const { result } = renderHook(() => useLineItemSelection(["a", "b"]));

    act(() => result.current.select("a"));
    expect(result.current.selectedId).toBe("a");

    act(() => result.current.clear());
    expect(result.current.selectedId).toBeNull();
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("auto-selects a freshly added line when the id set gains one id", () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useLineItemSelection(ids),
      { initialProps: { ids: ["a", "b"] } },
    );

    // No auto-selection on mount of an existing set.
    expect(result.current.selectedId).toBeNull();

    // A new line is added → its id appears → the hook auto-selects it.
    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.selectedId).toBe("c");
  });

  it("auto-clears when the selected line is deleted", () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useLineItemSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } },
    );

    act(() => result.current.select("b"));
    expect(result.current.selectedId).toBe("b");

    // The selected line "b" is removed from the set → selection clears.
    rerender({ ids: ["a", "c"] });
    expect(result.current.selectedId).toBeNull();
  });

  it("does NOT clear when a different (non-selected) line is deleted", () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useLineItemSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } },
    );

    act(() => result.current.select("a"));
    expect(result.current.selectedId).toBe("a");

    // A different line "b" is removed; the selected "a" remains untouched.
    rerender({ ids: ["a", "c"] });
    expect(result.current.selectedId).toBe("a");
    expect(result.current.isSelected("a")).toBe(true);
  });
});
