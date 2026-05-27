// `<ReferrerPicker>` is the shared picker behind the Edit Job Info dialog's
// new Referrer field (#298) and — in slice D — the intake-form's `referrer`
// field. Both consume `eligibilityFor()` so the dialog and the intake form
// cannot drift on what "Active Referral Partner" means.
//
// Coverage: which partners appear in which group (pickable / promote-then-pick
// / hidden), how the value flows through `onChange`, and how the promote
// affordance signals a status flip is needed.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ReferrerPicker from "./referrer-picker";
import type { ReferrerPickerPartner } from "./referrer-picker";

function partner(
  overrides: Partial<ReferrerPickerPartner> & {
    id: string;
    company_name: string;
  },
): ReferrerPickerPartner {
  return {
    status: "green",
    deleted_at: null,
    ...overrides,
  };
}

describe("ReferrerPicker — eligibility groups", () => {
  it("renders Active (green) partners as directly pickable", () => {
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-1", company_name: "Acme Plumbing", status: "green" }),
        ]}
        value={null}
        onChange={() => {}}
        onPromoteAndPick={() => {}}
      />,
    );

    expect(screen.getByText("Acme Plumbing")).toBeDefined();
  });

  it("groups yellow Targets under a `+ Promote and attach` heading", () => {
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-1", company_name: "Bravo Roofing", status: "yellow" }),
        ]}
        value={null}
        onChange={() => {}}
        onPromoteAndPick={() => {}}
      />,
    );

    expect(screen.getByText(/promote and attach/i)).toBeDefined();
    expect(screen.getByText("Bravo Roofing")).toBeDefined();
  });

  it("hides grey, red, and trashed rows entirely", () => {
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-grey", company_name: "Grey Co", status: "grey" }),
          partner({ id: "p-red", company_name: "Red Co", status: "red" }),
          partner({
            id: "p-trashed",
            company_name: "Trashed Co",
            status: "green",
            deleted_at: "2026-05-20T00:00:00Z",
          }),
        ]}
        value={null}
        onChange={() => {}}
        onPromoteAndPick={() => {}}
      />,
    );

    expect(screen.queryByText("Grey Co")).toBeNull();
    expect(screen.queryByText("Red Co")).toBeNull();
    expect(screen.queryByText("Trashed Co")).toBeNull();
  });
});

describe("ReferrerPicker — interaction", () => {
  it("clicking an Active partner fires onChange with the partner id", () => {
    const onChange = vi.fn();
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-1", company_name: "Acme Plumbing", status: "green" }),
        ]}
        value={null}
        onChange={onChange}
        onPromoteAndPick={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Acme Plumbing"));
    expect(onChange).toHaveBeenCalledWith("p-1");
  });

  it("clicking a yellow Target fires onPromoteAndPick — not onChange", () => {
    const onChange = vi.fn();
    const onPromoteAndPick = vi.fn();
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-1", company_name: "Bravo Roofing", status: "yellow" }),
        ]}
        value={null}
        onChange={onChange}
        onPromoteAndPick={onPromoteAndPick}
      />,
    );

    fireEvent.click(screen.getByText("Bravo Roofing"));
    expect(onPromoteAndPick).toHaveBeenCalledWith("p-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes a Clear control that fires onChange(null)", () => {
    const onChange = vi.fn();
    render(
      <ReferrerPicker
        partners={[
          partner({ id: "p-1", company_name: "Acme Plumbing", status: "green" }),
        ]}
        value="p-1"
        onChange={onChange}
        onPromoteAndPick={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
