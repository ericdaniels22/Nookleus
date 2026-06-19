import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Issue #722 (PRD #719) — the Job-detail status picker reads its five options
// from config (via getJobStatusOptions) instead of a hardcoded <option> list,
// so it shows the pipeline labels and reflects per-org renames without a code
// change. JobStatusSelect pulls the org's job_statuses off the config context;
// stub the context so the picker renders without a live ConfigProvider.
//
// The stubbed rows are deliberately in a NON-pipeline order and rename Lead to
// "Prospect" — proving the picker takes its ORDER from the presentation module
// and its LABELS from config.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    statuses: [
      { name: "cancelled", display_label: "Lost 😢" },
      { name: "new", display_label: "Prospect" },
      { name: "completed", display_label: "Closed" },
      { name: "in_progress", display_label: "Active" },
      { name: "pending_invoice", display_label: "Collections" },
    ],
  }),
}));

import { JobStatusSelect } from "./job-status-select";

describe("JobStatusSelect (#722)", () => {
  it("renders the five stages from config, pipeline-ordered with org labels", () => {
    render(<JobStatusSelect value="new" onChange={vi.fn()} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.textContent)).toEqual([
      "Prospect", // org renamed Lead → Prospect (label from config)
      "Active",
      "Collections",
      "Closed",
      "Lost 😢",
    ]);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "new",
      "in_progress",
      "pending_invoice",
      "completed",
      "cancelled",
    ]);
  });

  it("reflects the current status and emits the new key when a stage is picked", () => {
    const onChange = vi.fn();
    render(<JobStatusSelect value="new" onChange={onChange} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("new");

    fireEvent.change(select, { target: { value: "completed" } });
    expect(onChange).toHaveBeenCalledWith("completed");
  });
});
