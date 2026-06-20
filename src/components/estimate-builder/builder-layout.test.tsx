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
  // The docked editor pins with `position: sticky top-6`, so it can only travel
  // within the box of the <aside> that wraps it. That box only stays tall enough
  // when the <aside> stretches to the document column's full height — which rests
  // on FOUR things staying true. Each one below, if broken, re-creates bug #627
  // item 2 (editor scrolls away instead of pinning) while the others still pass.
  //
  // jsdom computes no layout, so the pin-while-scrolling behavior itself is
  // verified in the browser; these pin the layout *contract*, mirroring the
  // `max-w-`/`mx-auto` negation guards above. Every regex tolerates a
  // responsive/state prefix (`lg:`, `hover:`, …) via a leading `(?:^|[\s:])`.

  // (1) Cross-axis alignment on the row. The flex default is `stretch`, which is
  // what makes the <aside> span the document's full height. Any other cross-axis
  // value collapses it. `place-items-*` IS included: it is `align-items` +
  // `justify-items` shorthand and in a flex row the `align-items` half is honored
  // (the `justify-items` half is inert). `items-stretch`/`place-items-stretch`
  // restate the default and are intentionally not matched; `justify-items-*`
  // alone is inert in flex and is excluded by the leading anchor (preceded by
  // `-`, not start/space/`:`).
  const CROSS_AXIS_OVERRIDE =
    /(?:^|[\s:])(?:place-)?items-(?:start|center|end|baseline)\b/;

  // (2) Sticky scroll-context on the row. An ancestor of a sticky element with
  // `overflow` other than visible becomes that element's scroll container, so the
  // editor pins to the (short) row box and scrolls away with the page instead of
  // the viewport. `contain: paint|content|strict` clips the same way. This leaves
  // the row at `stretch` and the <aside> full-height, so neither guard (1) nor
  // (3) would catch it. (Bare `transform`/`filter` establish a containing block
  // only for fixed/absolute descendants, not a reliable sticky breaker, and are
  // left to the browser test rather than guarded speculatively here.)
  const STICKY_SCROLL_CONTEXT =
    /(?:^|[\s:])(?:overflow(?:-[xy])?-(?:hidden|auto|scroll|clip)|contain-(?:paint|content|strict))\b/;

  // (3) Height collapse on the <aside> itself. Under the row's `stretch`, a flex
  // item only fills the column height while its own height computes to `auto`.
  // `self-*` (and its `place-self-*` shorthand) opt out of stretch; `h-fit`/
  // `h-min` shrink to content; a definite height (`h-0`, `h-px`, arbitrary
  // `h-[…]`) or content-sized cap (`max-h-fit`/`max-h-min`) pins it shorter than
  // the document. (`self-stretch`, `h-auto`, `h-full`, `min-h-*`, and a
  // viewport/arbitrary `max-h-screen`/`max-h-[…]` cap are harmless and not
  // matched — the editor panel itself already carries `max-h-[calc(100vh-3rem)]`,
  // so banning every `max-h-` would over-fit.)
  const ASIDE_HEIGHT_COLLAPSE =
    /(?:^|[\s:])(?:(?:place-)?self-(?:start|center|end|baseline)|h-(?:fit|min|px|0|\[)|max-h-(?:fit|min))\b/;

  it("docks the document and editor as siblings of one lg:flex-row", () => {
    // Guards (1)-(3) all read `builder-document.parentElement` / the <aside>
    // className and trust that parent IS the side-by-side flex row. Two refactors
    // quietly break that assumption: wrapping <main> in an inner div (so
    // parentElement is no longer the alignment-bearing row), or lifting the
    // <aside> out of the row entirely (so it never participates in `stretch`).
    // Pin the structural invariant instead — <main> and <aside> share one parent,
    // and that parent docks them side-by-side at exactly `lg` (the editor panel's
    // DESKTOP_QUERY is min-width:1024px; an `xl:flex-row` mismatch would strand
    // the editor in the 1024-1280px band).
    render(
      <BuilderLayout editorSlot={<p>Editor</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    const main = screen.getByTestId("builder-document");
    const aside = screen.getByTestId("builder-editor-panel");
    expect(aside.parentElement).toBe(main.parentElement);
    expect(main.parentElement?.className).toMatch(/(?:^|\s)lg:flex-row\b/);
  });

  it("keeps the document/editor row at the stretch cross-axis default", () => {
    // ANY `items-*`/`place-items-*` other than stretch collapses the <aside> to
    // content height and leaves the sticky editor zero room to travel (#627
    // item 2). The original guard only negated `items-start`; a future
    // `items-center`/`-end`/`-baseline`/`place-items-*` tweak would silently
    // re-break it while still passing.
    render(
      <BuilderLayout editorSlot={<p>Editor</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    const row = screen.getByTestId("builder-document").parentElement;
    expect(row?.className).not.toMatch(CROSS_AXIS_OVERRIDE);
  });

  it("does not turn the document/editor row into a scroll container", () => {
    // Even with the row at `stretch` and the <aside> full-height, an `overflow`
    // (e.g. `overflow-x-clip` to tame a wide totals table) or `contain` on the
    // row captures the sticky editor as its scroll context — it then pins to the
    // row box and scrolls away with the page (#627 item 2).
    render(
      <BuilderLayout editorSlot={<p>Editor</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    const row = screen.getByTestId("builder-document").parentElement;
    expect(row?.className).not.toMatch(STICKY_SCROLL_CONTEXT);
  });

  it("does not collapse the editor <aside> to content height", () => {
    // Even with the row left at `stretch`, the <aside> can collapse itself by
    // opting out of stretch (`self-*`/`place-self-*`) or by taking a content/
    // definite height or content-sized cap (`h-fit`/`h-min`/`h-0`/`h-px`/`h-[…]`/
    // `max-h-fit`/`max-h-min`) — re-breaking the sticky editor's travel room
    // exactly as #627 item 2. No test inspected the <aside> before, so this
    // closes that gap.
    render(
      <BuilderLayout editorSlot={<p>Editor</p>}>
        <p>doc</p>
      </BuilderLayout>,
    );

    const aside = screen.getByTestId("builder-editor-panel");
    expect(aside.className).not.toMatch(ASIDE_HEIGHT_COLLAPSE);
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
