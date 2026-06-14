// Issue #543 — Estimate Builder: full-width desktop layout (BuilderLayout).
//
// BuilderLayout is the responsive shell that replaces the old narrow,
// centered document column (`max-w-4xl mx-auto`) shared by all three builder
// modes. This slice delivers ONLY the full-width frame plus an (empty)
// right-side editor-panel slot and an (empty) bottom totals-bar slot — the
// slot *content* arrives in later slices of PRD #541.
//
// These tests pin the layout contract through BuilderLayout's public props
// (children / editorSlot / totalsSlot) so the internal markup can be
// refactored freely.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderLayout } from "./builder-layout";

describe("BuilderLayout — document body", () => {
  it("renders the document passed as children", () => {
    render(
      <BuilderLayout>
        <p>Letterhead and sections live here</p>
      </BuilderLayout>,
    );

    expect(
      screen.getByText("Letterhead and sections live here"),
    ).not.toBeNull();
  });

  it("does not constrain the document to a narrow centered column", () => {
    // Acceptance: the builder document fills full content width — the old
    // narrow centered column (`max-w-4xl mx-auto`) must be gone.
    render(
      <BuilderLayout>
        <p>doc</p>
      </BuilderLayout>,
    );

    const doc = screen.getByTestId("builder-document");
    expect(doc.className).not.toMatch(/max-w-/);
    expect(doc.className).not.toContain("mx-auto");
  });
});

describe("BuilderLayout — sticky-editor travel room (#629)", () => {
  it("does not pin the document/editor row to content height", () => {
    // Acceptance (#629): the docked editor uses `position: sticky` and can only
    // travel within its parent's box. The row that holds the document <main> and
    // the editor <aside> must NOT align its children to the top (`items-start`),
    // which would collapse the <aside> to content height and leave the sticky
    // editor with zero room to travel — so it scrolls away instead of pinning.
    // Default `stretch` alignment lets the <aside> span the document height.
    //
    // jsdom computes no layout, so the pinned-while-scrolling behavior itself is
    // verified in the browser; this guards the layout contract from regressing,
    // mirroring the `max-w-`/`mx-auto` negation guard above.
    render(
      <BuilderLayout editorSlot={<p>Editor</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    const row = screen.getByTestId("builder-document").parentElement;
    expect(row?.className).not.toContain("items-start");
  });
});

describe("BuilderLayout — editor panel slot", () => {
  it("renders the editor panel content when an editorSlot is provided", () => {
    render(
      <BuilderLayout editorSlot={<p>Editor panel content</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    expect(screen.getByText("Editor panel content")).not.toBeNull();
  });

  it("renders no editor panel when the editorSlot is empty (this slice)", () => {
    // The editor-panel slot is reserved but stays EMPTY in this slice, so the
    // document keeps the full content row.
    render(
      <BuilderLayout>
        <p>doc</p>
      </BuilderLayout>,
    );

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });
});

describe("BuilderLayout — totals bar slot", () => {
  it("renders the totals bar content when a totalsSlot is provided", () => {
    render(
      <BuilderLayout totalsSlot={<p>Totals bar content</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    expect(screen.getByText("Totals bar content")).not.toBeNull();
  });

  it("renders no totals bar when no totalsSlot is provided (e.g. Template mode)", () => {
    // Templates pass no totalsSlot, so the bottom totals bar is omitted.
    render(
      <BuilderLayout>
        <p>doc</p>
      </BuilderLayout>,
    );

    expect(screen.queryByTestId("builder-totals-bar")).toBeNull();
  });
});

describe("BuilderLayout — document background click (#544)", () => {
  it("fires onBackgroundClick when the document surface is clicked", () => {
    // Clicking empty document space clears the editor selection (#544). The
    // handler lives on the document surface; rows stop propagation so a click
    // ON a row selects instead of clearing.
    const onBackgroundClick = vi.fn();
    render(
      <BuilderLayout onBackgroundClick={onBackgroundClick}>
        <p>doc</p>
      </BuilderLayout>,
    );

    fireEvent.click(screen.getByTestId("builder-document"));

    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });
});
