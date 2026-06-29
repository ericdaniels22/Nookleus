// #613 — client request for the Job detail's "Create showcase" action.
//
// POSTs an empty body to the admin-gated create route (the route fills in a
// blank draft the admin then names in the builder) and returns the created
// Showcase so the caller can navigate straight into its builder. The route is
// the single source of truth for the create rules (admin-only, one-per-Job,
// photo-ownership); this helper only owns the request/parse/error contract, kept
// out of the 2,000-line Job detail so it can be tested in isolation.

import type { Showcase } from "@/lib/types";

export async function requestCreateShowcase(jobId: string): Promise<Showcase> {
  const res = await fetch(`/api/jobs/${jobId}/showcases`, { method: "POST" });
  if (!res.ok) {
    // Surface the server's actionable message when there is one (e.g. the
    // one-per-Job 409 from a two-tab race), otherwise a generic fallback.
    const body = (await res.json().catch(() => null)) as
      | { error?: unknown }
      | null;
    const message =
      body && typeof body.error === "string"
        ? body.error
        : "Couldn't create the showcase. Try again.";
    throw new Error(message);
  }
  const { showcase } = (await res.json()) as { showcase: Showcase };
  return showcase;
}
