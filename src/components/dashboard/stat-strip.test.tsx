import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatStrip } from "./stat-strip";

describe("<StatStrip>", () => {
  it("shows the new-jobs column when canViewJobs is true", () => {
    render(<StatStrip newJobsCount={5} canViewJobs={true} />);
    // Pluralised count: "5 new jobs".
    expect(screen.getByText(/5 new jobs/i)).toBeTruthy();
  });

  it("hides the new-jobs column when canViewJobs is false", () => {
    render(<StatStrip newJobsCount={5} canViewJobs={false} />);
    // No count text — column is gone, not replaced with a permission notice.
    expect(screen.queryByText(/new jobs/i)).toBeNull();
    expect(screen.queryByText(/5/)).toBeNull();
  });
});
