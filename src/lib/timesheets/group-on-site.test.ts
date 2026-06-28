// group-on-site — projects the org-wide open-session roster down to "who is on
// site, per Job" (#705, epic #699). The Jobs list opens ONE org-scoped presence
// subscription and uses this to hand each Job card just its own names, instead
// of every card opening its own realtime channel (N cards → N channels).

import { describe, it, expect } from "vitest";
import { groupOnSiteNamesByJob } from "./group-on-site";
import type { OpenSessionPresence } from "./load-open-sessions";

function presence(over: Partial<OpenSessionPresence> = {}): OpenSessionPresence {
  return {
    sessionId: "s1",
    userId: "u1",
    jobId: "job-1",
    startedAt: "2026-06-27T14:00:00.000Z",
    workerName: "Jordan Rivera",
    job: null,
    ...over,
  };
}

describe("groupOnSiteNamesByJob", () => {
  it("groups worker names by the Job they're on", () => {
    const byJob = groupOnSiteNamesByJob([
      presence({ sessionId: "a", jobId: "job-1", workerName: "Jordan Rivera" }),
      presence({ sessionId: "b", jobId: "job-1", workerName: "Sam Diaz" }),
      presence({ sessionId: "c", jobId: "job-2", workerName: "Lee Park" }),
    ]);

    expect(byJob.get("job-1")).toEqual(["Jordan Rivera", "Sam Diaz"]);
    expect(byJob.get("job-2")).toEqual(["Lee Park"]);
    // A Job no one is on site at simply isn't a key.
    expect(byJob.get("job-3")).toBeUndefined();
  });
});
