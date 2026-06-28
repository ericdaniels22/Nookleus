import type { OpenSessionPresence } from "./load-open-sessions";

// Projects the org-wide open-session roster down to "who is on site, per Job"
// (#705, epic #699). The Jobs list opens ONE org-scoped presence subscription
// and uses this to hand each Job card just its own names — avoiding N cards
// each opening their own realtime channel.
//
// A worker with no profile name still counts as a presence (names only — never
// dropped); they show as "A worker", matching the per-Job container.
export function groupOnSiteNamesByJob(
  sessions: OpenSessionPresence[],
): Map<string, string[]> {
  const byJob = new Map<string, string[]>();
  for (const s of sessions) {
    const names = byJob.get(s.jobId) ?? [];
    names.push(s.workerName ?? "A worker");
    byJob.set(s.jobId, names);
  }
  return byJob;
}
