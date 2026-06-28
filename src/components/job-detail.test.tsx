import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ── Why this test exists (#751) ───────────────────────────────────────────
// #676 made a failed swipe-to-refresh keep the on-screen data and toast. That
// "keep-data" guarantee rests entirely on JobDetail's fetchData throwing the
// core fetch error BEFORE any setState — so a failed reload applies none of
// its results and the page stays exactly as it was (atomic). The existing
// wrapper tests in pull-to-refresh.test.tsx assert the catch-and-toast policy
// against a static child, which is tautological for the real component
// (PullToRefresh always renders {children}). Nothing exercised the real
// JobDetail throw path end-to-end — so the throw could silently move after the
// setStates and every test would still pass. This test closes that gap.
//
// The discriminator is deliberately a *sibling* query (the photo count, the
// email count), not the job header: on a failed refresh the jobs row comes
// back `{ data: null, error }`, so `if (jobRes.data) setJob(...)` is skipped
// regardless of where the throw sits — the header survives either way and
// can't tell the orderings apart. The sibling counts, however, would advance
// to their fresh values if the setStates ran after the throw. Asserting they
// DON'T is what locks the ordering.

// Native app: PullToRefresh is active (the gesture wraps the page). Off-native
// it's a passthrough and the pull would be inert, so this must report native.
vi.mock("@/lib/mobile/use-capacitor", () => ({
  useCapacitor: () => ({ isNative: true, ready: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    profile: { id: "u-1", full_name: "Tester", role: "admin" },
    hasPermission: () => true,
  }),
}));

vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusColor: () => "",
    getStatusLabel: (name: string) => name,
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Heavy children stubbed to nothing: this test exercises JobDetail's own
// fetch/render path and the *real* PullToRefresh wrapper, not theirs.
vi.mock("@/components/job-detail/financials-tab", () => ({ default: () => null }));
vi.mock("@/components/activity-timeline", () => ({ default: () => null }));
vi.mock("@/components/photo-upload", () => ({ default: () => null }));
vi.mock("@/components/photo-viewer", () => ({ default: () => null }));
vi.mock("@/components/photo-annotator", () => ({ default: () => null }));
vi.mock("@/components/compose-email", () => ({ default: () => null }));
vi.mock("@/components/jarvis/JarvisJobPanel", () => ({ default: () => null }));
vi.mock("@/components/job-files", () => ({ default: () => null }));
vi.mock("@/components/contracts/contracts-section", () => ({ default: () => null }));
vi.mock("@/components/mobile/capture-fab", () => ({ default: () => null }));
vi.mock("@/components/insurance-company-picker", () => ({ default: () => null }));
vi.mock("@/components/referral-partners/referrer-picker", () => ({ default: () => null }));
vi.mock("@/components/job-photos-tab", () => ({ default: () => null }));
vi.mock("@/components/job-time-tab", () => ({ default: () => null }));
vi.mock("@/components/photo-preloader", () => ({ default: () => null }));
vi.mock("@/components/job-detail/estimates-invoices-section", () => ({ EstimatesInvoicesSection: () => null }));
vi.mock("@/components/email/job-email-row", () => ({ JobEmailRow: () => null }));
vi.mock("@/components/job-detail/job-messages-section", () => ({ JobMessagesSection: () => null }));
vi.mock("@/components/job-detail/job-calls-section", () => ({ JobCallsSection: () => null }));
vi.mock("@/components/job-detail/job-status-select", () => ({ JobStatusSelect: () => null }));
vi.mock("@/components/phone/click-to-call", () => ({ ClickToCall: () => null }));
// Presence "On site now" (#705) opens its own realtime channel on mount; this
// test's fake client has no `.channel()`, and presence is orthogonal to the
// swipe-to-refresh data-preservation path under test — stub it to nothing.
vi.mock("@/components/time/on-site-now", () => ({ default: () => null }));

// Supabase: a chainable query builder whose terminal (.single / .maybeSingle /
// await) resolves to a per-table result. `resultsByTable` is swapped between
// the successful mount load and the reload so the same query returns different
// rows in each phase — read lazily at call time, mirroring job-cover-picker's
// mutable-result template.
type TableResult = { data?: unknown; count?: number; error?: unknown };
const DEFAULT_RESULT: TableResult = { data: [], count: 0, error: null };
let resultsByTable: Record<string, TableResult> = {};

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "order", "limit", "update", "delete"]) {
        builder[method] = () => builder;
      }
      const resolve = () => resultsByTable[table] ?? DEFAULT_RESULT;
      builder.single = () => Promise.resolve(resolve());
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.then = (cb: (r: unknown) => void) => cb(resolve());
      return builder;
    },
  }),
}));

// Imported after the mocks are registered.
import JobDetail from "./job-detail";
import { toast } from "sonner";

// A minimal job the header can render. created_at must be a real date — the
// Intake-Date row formats it and date-fns throws on an invalid Date.
const JOB = {
  id: "job-1",
  job_number: "JOB-1001",
  status: "active",
  urgency: "high",
  damage_type: "water",
  created_at: "2026-05-01T00:00:00Z",
  contact: { id: "c-1", full_name: "Ada Lovelace", role: "homeowner", phone: null, email: null },
  estimated_crew_labor_cost: null,
  organization_id: "org-1",
};

// The successful mount load: 3 photos, 1 email.
function mountResults(): Record<string, TableResult> {
  return {
    jobs: { data: JOB, error: null },
    photos: { data: [], count: 3, error: null },
    emails: { data: [{ id: "e1" }], error: null },
  };
}

// A FAILED reload: the core `jobs` fetch errors (data null, as Supabase
// returns it), while the sibling queries succeed with fresh, different
// counts. The atomic throw-before-setState ordering must leave every
// on-screen value untouched — none of these fresh counts may land.
function failedReloadResults(): Record<string, TableResult> {
  return {
    jobs: { data: null, error: { message: "Failed to fetch", code: "PGRST301" } },
    photos: { data: [], count: 99, error: null },
    emails: { data: [{ id: "eA" }, { id: "eB" }], error: null },
  };
}

// A SUCCESSFUL reload: everything resolves with fresh counts. Proves the
// reload path *does* apply new data when it succeeds — so the failed-reload
// "unchanged" assertions below aren't vacuously true against a dead mock.
function successfulReloadResults(): Record<string, TableResult> {
  return {
    jobs: { data: JOB, error: null },
    photos: { data: [], count: 5, error: null },
    emails: { data: [{ id: "eA" }, { id: "eB" }], error: null },
  };
}

// The Photos tab button carries the live photo count as a badge; the Emails
// section heading carries the live email count. Both read straight from
// JobDetail state, so they track exactly what the last applied fetch set.
const photosTab = () => screen.getByRole("button", { name: /Photos/ });
const emailsHeading = () => screen.getByRole("heading", { name: /Emails/ });

// One downward pull (start → move → release) past the 64px threshold, fired on
// a descendant so it bubbles to PullToRefresh's wrapper handlers — then drained
// to completion. The reload is a floating promise the hook kicks off
// (`void onRefresh().finally(...)`) plus a min-spin setTimeout (#677, 500ms);
// fake timers let us run BOTH to settlement deterministically, so the
// assertions read a fully-settled page instead of racing the reload's
// resolution. (Mirrors the min-spin handling in pull-to-refresh.test.tsx.)
async function pullAndSettle(el: HTMLElement) {
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientY: 200 }] });
      // Drains the reload's microtask chain at each timer step, then fires the
      // 500ms min-spin timer (600 > 500 leaves margin).
      await vi.advanceTimersByTimeAsync(600);
    });
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  resultsByTable = mountResults();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("JobDetail — swipe-to-refresh data preservation (#751)", () => {
  it("keeps the prior job data and counts (and toasts) when the reload's core fetch fails", async () => {
    render(<JobDetail jobId="job-1" />);

    // Mount load succeeds: the job and its counts paint. (The contact name
    // shows in both the header and the homeowner card — hence getAllByText.)
    expect(await screen.findByText("JOB-1001")).toBeTruthy();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(photosTab().textContent).toContain("3");
    expect(emailsHeading().textContent).toContain("(1)");

    // The next reload's core fetch fails; its siblings would return 99 / 2.
    resultsByTable = failedReloadResults();
    await pullAndSettle(screen.getByText("JOB-1001"));

    // A clear, single failure toast fired...
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't refresh — check your connection.");

    // ...and NOTHING on screen advanced: the page is atomic on a failed reload.
    // If the throw moved after the setState block, the sibling counts would
    // have jumped to 99 / "(2)" here — these assertions are what lock the
    // throw-before-setState ordering.
    expect(screen.getByText("JOB-1001")).toBeTruthy();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(photosTab().textContent).toContain("3");
    expect(photosTab().textContent).not.toContain("99");
    expect(emailsHeading().textContent).toContain("(1)");
    expect(emailsHeading().textContent).not.toContain("(2)");
  });

  it("applies fresh data and does not toast when the reload succeeds", async () => {
    render(<JobDetail jobId="job-1" />);

    expect(await screen.findByText("JOB-1001")).toBeTruthy();
    expect(photosTab().textContent).toContain("3");
    expect(emailsHeading().textContent).toContain("(1)");

    // This reload succeeds with fresh counts (5 photos, 2 emails).
    resultsByTable = successfulReloadResults();
    await pullAndSettle(screen.getByText("JOB-1001"));

    // The new counts land...
    expect(photosTab().textContent).toContain("5");
    expect(emailsHeading().textContent).toContain("(2)");
    // ...and a quiet success surfaces no error toast.
    expect(toast.error).not.toHaveBeenCalled();
  });
});
