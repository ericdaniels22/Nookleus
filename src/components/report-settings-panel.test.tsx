// Issue #550 — the in-builder Report Settings panel behind the top-bar gear.
//
// The panel is a thin, controlled view over the report's resolved layout: it
// shows the chosen photos-per-page and the six detail toggles, and turns a
// click into the matching reducer action. Its tests exercise that public
// behavior — what the user sees and what gets dispatched — not its markup.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import ReportSettingsPanel from "./report-settings-panel";

const ALL_ON = {
  sectionTitlePages: true,
  photoNumbers: true,
  capturedBy: true,
  location: true,
  dateCaptured: true,
  photoTags: true,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ReportSettingsPanel>> = {},
) {
  const dispatch = vi.fn();
  const onClose = vi.fn();
  render(
    <ReportSettingsPanel
      photosPerPage={2}
      details={ALL_ON}
      dispatch={dispatch}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { dispatch, onClose };
}

afterEach(cleanup);

describe("ReportSettingsPanel", () => {
  it("offers 2/3/4 photos-per-page and marks the current layout pressed", () => {
    renderPanel({ photosPerPage: 3 });
    expect(screen.getByRole("button", { name: /2 per page/i })).toBeDefined();
    const three = screen.getByRole("button", { name: /3 per page/i });
    expect(three).toBeDefined();
    expect(screen.getByRole("button", { name: /4 per page/i })).toBeDefined();
    expect(three.getAttribute("aria-pressed")).toBe("true");
  });

  it("dispatches setPhotosPerPage when a density is picked", () => {
    const { dispatch } = renderPanel({ photosPerPage: 2 });
    fireEvent.click(screen.getByRole("button", { name: /4 per page/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setPhotosPerPage",
      photosPerPage: 4,
    });
  });

  it("renders all six detail toggles, reflecting their on/off state", () => {
    renderPanel({
      details: { ...ALL_ON, photoNumbers: false },
    });
    const checkbox = (name: RegExp) =>
      screen.getByRole("checkbox", { name }) as HTMLInputElement;
    expect(checkbox(/section title pages/i).checked).toBe(true);
    expect(checkbox(/photo numbers/i).checked).toBe(false);
    expect(checkbox(/captured by/i).checked).toBe(true);
    expect(checkbox(/location/i).checked).toBe(true);
    expect(checkbox(/date captured/i).checked).toBe(true);
    expect(checkbox(/photo tags/i).checked).toBe(true);
  });

  it("dispatches toggleReportField for the field whose toggle is clicked", () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /date captured/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggleReportField",
      field: "dateCaptured",
    });
  });

  it("does not render a configurable Photo Page Header (dropped in #550)", () => {
    renderPanel();
    expect(screen.queryByText(/photo page header/i)).toBeNull();
    expect(screen.queryByText(/header.*left/i)).toBeNull();
  });

  it("closes when the X button is pressed", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed (WCAG 2.1 modal dismissal)", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the decorative backdrop is clicked", () => {
    // The backdrop is aria-hidden (not a button), so it is queried by its click
    // target, not a role: clicking the scrim behind the dialog dismisses it.
    const { onClose } = renderPanel();
    const dialog = screen.getByRole("dialog");
    // The backdrop is the dialog's sibling fixed overlay; their shared parent
    // wraps both. Scope to a *direct* child so the match can't fall through to
    // the lucide X icon's own aria-hidden <svg> nested inside the dialog.
    const backdrop = dialog.parentElement!.querySelector(
      ':scope > [aria-hidden="true"]',
    ) as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
