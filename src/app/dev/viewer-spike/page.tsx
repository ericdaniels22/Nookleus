// SPIKE — THROWAWAY (issue #463 reliability gate). NOT production code.
//
// Proves the react-pdf in-app document viewer renders the REAL customer-facing
// Estimate and Invoice /preview PDFs reliably in Chrome AND Edge on Windows.
// Its output is evidence for the #463 go/no-go, not shippable viewer code — the
// production viewer is slice #464. Delete this whole folder once the decision is
// recorded. Guarded with notFound() so it can never serve in production even if
// it is accidentally merged. See ./README.md.

import { notFound } from "next/navigation";
import { ViewerSpikeClient } from "./viewer-spike-client";

export const dynamic = "force-dynamic";

export default function ViewerSpikePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ViewerSpikeClient />;
}
