import { describe, it, expect } from "vitest";
import {
  pagePickerReducer,
  initialPagePickerState,
} from "./page-picker-reducer";

describe("pagePickerReducer", () => {
  it("setActivePage moves the active page to a page inside the range", () => {
    const state = { numPages: 5, activePage: 1 };

    const next = pagePickerReducer(state, { type: "setActivePage", page: 3 });

    expect(next.activePage).toBe(3);
  });

  it("setActivePage clamps a page past the end down to the last page", () => {
    const state = { numPages: 5, activePage: 1 };

    const next = pagePickerReducer(state, { type: "setActivePage", page: 9 });

    expect(next.activePage).toBe(5);
  });

  it("setActivePage clamps a page before the start up to the first page", () => {
    const state = { numPages: 5, activePage: 3 };

    const next = pagePickerReducer(state, { type: "setActivePage", page: 0 });

    expect(next.activePage).toBe(1);
  });

  it("next advances to the following page", () => {
    const state = { numPages: 5, activePage: 2 };

    const next = pagePickerReducer(state, { type: "next" });

    expect(next.activePage).toBe(3);
  });

  it("next on the last page stays on the last page", () => {
    const state = { numPages: 5, activePage: 5 };

    const next = pagePickerReducer(state, { type: "next" });

    expect(next.activePage).toBe(5);
  });

  it("prev steps back to the previous page", () => {
    const state = { numPages: 5, activePage: 3 };

    const next = pagePickerReducer(state, { type: "prev" });

    expect(next.activePage).toBe(2);
  });

  it("prev on the first page stays on the first page", () => {
    const state = { numPages: 5, activePage: 1 };

    const next = pagePickerReducer(state, { type: "prev" });

    expect(next.activePage).toBe(1);
  });

  describe("single-page document", () => {
    const single = { numPages: 1, activePage: 1 };

    it("next cannot leave the only page", () => {
      expect(pagePickerReducer(single, { type: "next" }).activePage).toBe(1);
    });

    it("prev cannot leave the only page", () => {
      expect(pagePickerReducer(single, { type: "prev" }).activePage).toBe(1);
    });

    it("setActivePage to any number resolves to the only page", () => {
      expect(
        pagePickerReducer(single, { type: "setActivePage", page: 4 }).activePage,
      ).toBe(1);
    });
  });

  describe("before the page count is known", () => {
    // initialPagePickerState starts with numPages: 0 — the document has not
    // reported its length yet, so there is no range to navigate within.
    it("starts on page 1 with no known count", () => {
      expect(initialPagePickerState).toEqual({ numPages: 0, activePage: 1 });
    });

    it("setActivePage holds on page 1 until the count is known", () => {
      expect(
        pagePickerReducer(initialPagePickerState, {
          type: "setActivePage",
          page: 5,
        }).activePage,
      ).toBe(1);
    });

    it("next holds on page 1 until the count is known", () => {
      expect(
        pagePickerReducer(initialPagePickerState, { type: "next" }).activePage,
      ).toBe(1);
    });
  });

  describe("setNumPages", () => {
    it("records the page count the document reports", () => {
      const next = pagePickerReducer(initialPagePickerState, {
        type: "setNumPages",
        numPages: 5,
      });

      expect(next.numPages).toBe(5);
      expect(next.activePage).toBe(1);
    });

    it("pulls the active page back into range when the document shrinks", () => {
      // A Retry can reload a document with fewer pages; the active page must not
      // be left pointing past the new end.
      const state = { numPages: 10, activePage: 8 };

      const next = pagePickerReducer(state, { type: "setNumPages", numPages: 3 });

      expect(next.numPages).toBe(3);
      expect(next.activePage).toBe(3);
    });
  });
});
