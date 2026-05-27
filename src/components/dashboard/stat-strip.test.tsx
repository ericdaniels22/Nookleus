import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatStrip } from "./stat-strip";

describe("<StatStrip>", () => {
  it("shows the new-jobs column when canViewJobs is true", () => {
    render(
      <StatStrip
        newJobsCount={5}
        canViewJobs={true}
        unreadResponsesCount={0}
        canViewEmail={false}
      />
    );
    expect(screen.getByText(/5 new jobs/i)).toBeTruthy();
  });

  it("hides the new-jobs column when canViewJobs is false", () => {
    render(
      <StatStrip
        newJobsCount={5}
        canViewJobs={false}
        unreadResponsesCount={0}
        canViewEmail={false}
      />
    );
    expect(screen.queryByText(/new jobs/i)).toBeNull();
    expect(screen.queryByText(/5/)).toBeNull();
  });

  it("shows the unread-responses column when canViewEmail is true", () => {
    render(
      <StatStrip
        newJobsCount={0}
        canViewJobs={false}
        unreadResponsesCount={7}
        canViewEmail={true}
      />
    );
    expect(screen.getByText(/7 unread responses/i)).toBeTruthy();
  });

  it("hides the unread-responses column when canViewEmail is false", () => {
    render(
      <StatStrip
        newJobsCount={0}
        canViewJobs={false}
        unreadResponsesCount={7}
        canViewEmail={false}
      />
    );
    expect(screen.queryByText(/unread responses/i)).toBeNull();
    expect(screen.queryByText(/7/)).toBeNull();
  });

  it("shows both columns when both permissions are true", () => {
    render(
      <StatStrip
        newJobsCount={3}
        canViewJobs={true}
        unreadResponsesCount={2}
        canViewEmail={true}
      />
    );
    expect(screen.getByText(/3 new jobs/i)).toBeTruthy();
    expect(screen.getByText(/2 unread responses/i)).toBeTruthy();
  });

  it("hides both columns when both permissions are false", () => {
    render(
      <StatStrip
        newJobsCount={3}
        canViewJobs={false}
        unreadResponsesCount={2}
        canViewEmail={false}
      />
    );
    expect(screen.queryByText(/new jobs/i)).toBeNull();
    expect(screen.queryByText(/unread responses/i)).toBeNull();
  });
});
