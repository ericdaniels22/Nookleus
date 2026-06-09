// Behavior coverage for MoneyInput (#542) — the $-prefixed numeric box used for
// the line-item unit cost and the fixed-dollar Markup/Discount fields. Tests
// exercise the public contract only: value seeding, commit-on-blur parsing,
// rejection of non-numeric input, no comma reformatting mid-type, and the
// optional live callback that keeps a consumer's running total ticking.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MoneyInput } from "./money-input";

function box(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

describe("MoneyInput", () => {
  it("renders a fixed $ adornment", () => {
    render(<MoneyInput value={10} onCommit={vi.fn()} />);
    expect(screen.getByText("$")).toBeDefined();
  });

  it("seeds the box with the numeric value", () => {
    render(<MoneyInput value={12.5} onCommit={vi.fn()} />);
    expect(box().value).toBe("12.5");
  });

  it("commits the typed amount as a number on blur", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={10} onCommit={onCommit} />);

    fireEvent.change(box(), { target: { value: "12.5" } });
    fireEvent.blur(box());

    expect(onCommit).toHaveBeenCalledWith(12.5);
  });

  it("rejects non-numeric input: never commits NaN and snaps back to the last value", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={10} onCommit={onCommit} />);

    fireEvent.change(box(), { target: { value: "abc" } });
    fireEvent.blur(box());

    expect(onCommit).not.toHaveBeenCalled();
    expect(box().value).toBe("10");
  });

  it("does not reformat with commas while typing (caret never jumps)", () => {
    render(<MoneyInput value={0} onCommit={vi.fn()} />);

    fireEvent.change(box(), { target: { value: "1234.5" } });

    expect(box().value).toBe("1234.5");
  });

  it("reflects an external change to the value (server reconcile)", () => {
    const { rerender } = render(<MoneyInput value={10} onCommit={vi.fn()} />);
    rerender(<MoneyInput value={20} onCommit={vi.fn()} />);
    expect(box().value).toBe("20");
  });

  it("treats a cleared box as no change: reverts instead of committing 0", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={10} onCommit={onCommit} />);

    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());

    expect(onCommit).not.toHaveBeenCalled();
    expect(box().value).toBe("10");
  });

  it("fires the optional onValueChange with raw text on each keystroke", () => {
    const onValueChange = vi.fn();
    render(
      <MoneyInput value={0} onCommit={vi.fn()} onValueChange={onValueChange} />,
    );

    fireEvent.change(box(), { target: { value: "20" } });

    expect(onValueChange).toHaveBeenCalledWith("20");
  });

  it("renders a non-editable field when readOnly", () => {
    render(<MoneyInput value={10} onCommit={vi.fn()} readOnly />);
    expect(box().readOnly).toBe(true);
  });

  it("forwards the placeholder to the input", () => {
    render(<MoneyInput value={0} onCommit={vi.fn()} placeholder="0.00" />);
    expect(box().placeholder).toBe("0.00");
  });
});
