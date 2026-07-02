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

// Config shape mirrors what the migrated Jobs surfaces consume (#914): label
// getters plus the raw `statuses` / `damageTypes` rows the §2.6 badge
// resolvers read. `getStatusColor` is deliberately absent — the legacy getter
// emits runtime `bg-[#hex]` classes (JIT-broken, non-§2.6) and #928 moves this
// view off it; a regression back to it crashes here.
const CONFIG = vi.hoisted(() => ({
  statuses: [] as { id: string; name: string; display_label: string; bg_color: string; text_color: string; sort_order: number; is_default: boolean; created_at: string }[],
  damageTypes: [] as { id: string; name: string; display_label: string; bg_color: string; text_color: string; icon: string | null; sort_order: number; is_default: boolean }[],
}));

vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusLabel: (name: string) => CONFIG.statuses.find((s) => s.name === name)?.display_label ?? name,
    getDamageTypeLabel: (name: string) => CONFIG.damageTypes.find((d) => d.name === name)?.display_label ?? name,
    statuses: CONFIG.statuses,
    damageTypes: CONFIG.damageTypes,
  }),
}));

// The active tab is URL-driven (`?tab=`), so tests select a tab by mounting
// with the query string already set — the router mock is a no-op.
const NAV = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(NAV.search),
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
// When true every query hangs unresolved, pinning the page in its loading
// state so the skeleton can be asserted deterministically.
let hangFetches = false;

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "order", "limit", "update", "delete"]) {
        builder[method] = () => builder;
      }
      const resolve = () => resultsByTable[table] ?? DEFAULT_RESULT;
      const pending = new Promise(() => {});
      builder.single = () => (hangFetches ? pending : Promise.resolve(resolve()));
      builder.maybeSingle = () => (hangFetches ? pending : Promise.resolve(resolve()));
      builder.then = (cb: (r: unknown) => void) => {
        if (!hangFetches) cb(resolve());
      };
      return builder;
    },
  }),
}));

// Imported after the mocks are registered.
import JobDetail from "./job-detail";
import { toast } from "sonner";
import { soften } from "@/lib/badge-colors";

// jsdom serializes inline colors to `rgb(...)`; convert soften()'s hex output
// for exact style comparisons.
function hexToRgb(hex: string): string {
  const n = hex.replace(/^#/, "");
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
}

// A minimal job the header can render. created_at must be a real date — the
// Intake-Date row formats it and date-fns throws on an invalid Date.
const JOB = {
  id: "job-1",
  job_number: "JOB-1001",
  status: "active",
  urgency: "scheduled",
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
  CONFIG.statuses = [];
  CONFIG.damageTypes = [];
  NAV.search = "";
  hangFetches = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("JobDetail — Sketch tab (#860)", () => {
  it("offers a Sketch tab that links to the Job's Sketch builder route", async () => {
    render(<JobDetail jobId="job-1" />);

    // Wait for the hub to paint, then the Sketch entry is a tab that takes the
    // user straight into the dedicated builder route for this Job.
    expect(await screen.findByText("JOB-1001")).toBeTruthy();
    const sketchTab = screen.getByRole("link", { name: /Sketch/ });
    expect(sketchTab.getAttribute("href")).toBe("/jobs/job-1/sketch");
  });
});

describe("JobDetail — header badge cluster (§2.6, #928)", () => {
  it("renders the status badge as the config-driven color softened into the tint treatment (ADR 0022)", async () => {
    CONFIG.statuses = [{
      id: "s1", name: "active", display_label: "In Progress",
      bg_color: "#DBEAFE", text_color: "#1D4ED8",
      sort_order: 1, is_default: true, created_at: "2026-01-01T00:00:00Z",
    }];
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // The badge carries the config label, and its colors are the stored pair
    // run through soften() — a ~14%-alpha tint of the stored bg plus an
    // AA-legible text tone — never the raw color, never a runtime bg-[#hex].
    const badge = screen.getByText("In Progress");
    const expected = soften("#DBEAFE", "#1D4ED8");
    expect(badge.style.background).toContain("219, 234, 254");
    expect(badge.style.background).toContain("0.14");
    expect(badge.style.color).toBe(hexToRgb(expected.color));
    expect(badge.className).not.toContain("bg-[");
  });

  it("renders an uncustomized seeded damage type with its vivid canonical class and config label", async () => {
    // Stored colors match the water seed exactly → the resolver hands back the
    // canonical dark-vivid class instead of softening the light-theme seed pair.
    CONFIG.damageTypes = [{
      id: "d1", name: "water", display_label: "Water Damage",
      bg_color: "#E6F1FB", text_color: "#0C447C",
      icon: null, sort_order: 1, is_default: true,
    }];
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Config label (not the static fallback "Water"), vivid class, no inline style.
    const badge = screen.getByText("Water Damage");
    expect(badge.className).toContain("text-sky-300");
    expect(badge.className).toContain("bg-sky-400/14");
    expect(badge.getAttribute("style")).toBeNull();
  });

  it("softens an org-customized damage color into an inline tint instead of the canonical class", async () => {
    // Stored colors differ from the water seed → the org customized them, so
    // the resolver preserves the chosen hue as a soften()ed inline style.
    CONFIG.damageTypes = [{
      id: "d1", name: "water", display_label: "Water",
      bg_color: "#7C3AED", text_color: "#FFFFFF",
      icon: null, sort_order: 1, is_default: true,
    }];
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    const badge = screen.getByText("Water");
    const expected = soften("#7C3AED", "#FFFFFF");
    expect(badge.style.background).toContain("124, 58, 237");
    expect(badge.style.background).toContain("0.14");
    expect(badge.style.color).toBe(hexToRgb(expected.color));
    expect(badge.className).not.toContain("text-sky-300");
  });

  it("renders the contract-signed badge on accent-tint tokens", async () => {
    resultsByTable.jobs = { data: { ...JOB, has_signed_contract: true }, error: null };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Signed = success family → the accent tint pair, not the raw emerald rgba trio.
    const badge = screen.getByText("Contract signed");
    expect(badge.className).toContain("bg-accent-tint");
    expect(badge.className).toContain("text-accent-text");
    expect(badge.className).not.toMatch(/\[#|rgba\(/);
  });

  it("renders the awaiting-signature badge on warning-tint tokens", async () => {
    resultsByTable.jobs = { data: { ...JOB, has_pending_contract: true }, error: null };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Pending signature = warning family (§2.5), not the raw amber rgba trio.
    const badge = screen.getByText("Awaiting signature");
    expect(badge.className).toContain("bg-warning-tint");
    expect(badge.className).toContain("text-amber-400");
    expect(badge.className).not.toMatch(/\[#|rgba\(/);
  });

  it("renders the payer-type badge as a class-based tint, keeping its hue per payer", async () => {
    resultsByTable.jobs = { data: { ...JOB, payer_type: "homeowner" }, error: null };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Homeowner keeps its sky hue but as ~14% tint classes — the inline
    // rgba trio (bg/color/border) goes away entirely.
    const badge = screen.getByText("Homeowner");
    expect(badge.className).toContain("bg-sky-400/14");
    expect(badge.className).toContain("text-sky-300");
    expect(badge.getAttribute("style")).toBeNull();
  });

  it("renders report status badges as tints: generated = accent, draft = violet", async () => {
    resultsByTable.photo_reports = {
      data: [
        { id: "r1", title: "Roof Report", report_date: "2026-05-02", status: "generated", deleted_at: null },
        { id: "r2", title: "Interior Report", report_date: "2026-05-03", status: "draft", deleted_at: null },
      ],
      error: null,
    };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Generated = done/success → accent tint; draft keeps the violet hue as a
    // ~14% tint. Neither may carry the light-theme #E1F5EE / #F3F0FF pills.
    const generated = screen.getByText("generated");
    expect(generated.className).toContain("bg-accent-tint");
    expect(generated.className).toContain("text-accent-text");
    expect(generated.className).not.toMatch(/\[#|rgba\(/);

    const draft = screen.getByText("draft");
    expect(draft.className).toContain("bg-violet-400/14");
    expect(draft.className).toContain("text-violet-300");
    expect(draft.className).not.toMatch(/\[#|rgba\(/);
  });

  it("renders the showcase Published badge on accent-tint tokens", async () => {
    resultsByTable.showcases = {
      data: { id: "sc1", title: "Storm Story", status: "published", photo_ids: ["p1"] },
      error: null,
    };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Published = live/success → accent tint, not the raw emerald rgba trio.
    const badge = screen.getByText("Published");
    expect(badge.className).toContain("bg-accent-tint");
    expect(badge.className).toContain("text-accent-text");
    expect(badge.className).not.toMatch(/\[#|rgba\(/);
  });

  it("renders a maximal overview with zero hardcoded palette classes (§8 DoD)", async () => {
    // Every conditional badge/chip at once: signed contract, payer type,
    // published showcase, generated + draft reports, config-colored badges.
    resultsByTable.jobs = {
      data: { ...JOB, has_signed_contract: true, payer_type: "mixed" },
      error: null,
    };
    resultsByTable.photo_reports = {
      data: [
        { id: "r1", title: "Roof Report", report_date: "2026-05-02", status: "generated", deleted_at: null },
        { id: "r2", title: "Interior Report", report_date: "2026-05-03", status: "draft", deleted_at: null },
      ],
      error: null,
    };
    resultsByTable.showcases = {
      data: { id: "sc1", title: "Storm Story", status: "published", photo_ids: ["p1"] },
      error: null,
    };
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // No class anywhere may smuggle a raw color: arbitrary hex (`bg-[#…]`),
    // arbitrary rgba, or the deleted vibrant-* palette (resolves to nothing).
    // Arbitrary *sizes* (`text-[11px]`, `-mb-[2px]`) are fine.
    const offenders = Array.from(document.querySelectorAll("*"))
      .map((el) => el.getAttribute("class") ?? "")
      .filter((c) => /\[#|rgba\(|vibrant/.test(c));
    expect(offenders).toEqual([]);
  });
});

describe("JobDetail — tab bar on tokens (§2.6/§8, #928)", () => {
  it("marks the active tab with primary-token classes, not hardcoded brand hex", async () => {
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Overview is the default active tab; the underline/text must come from
    // the --primary token (the migrated tab pattern), never a bg-[#hex] class.
    const overview = screen.getByRole("button", { name: "Overview" });
    expect(overview.className).toContain("text-primary");
    expect(overview.className).toContain("border-primary");
    expect(overview.className).not.toContain("[#");

    const financials = screen.getByRole("button", { name: "Financials" });
    expect(financials.className).toContain("text-muted-foreground");
    expect(financials.className).not.toContain("[#");
  });

  it("renders the active Photos count chip with accent-tint tokens", async () => {
    NAV.search = "tab=photos";
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // The chip is the count span inside the Photos tab; active = accent tint
    // pair from the token palette, never the light-theme #dbeafe pill.
    const chip = screen.getByText("3");
    expect(chip.className).toContain("bg-accent-tint");
    expect(chip.className).toContain("text-accent-text");
    expect(chip.className).not.toContain("[#");
  });
});

describe("JobDetail — loading and error states (§5/§6, #928)", () => {
  it("shows a shimmer-free muted skeleton while the job loads", () => {
    hangFetches = true;
    render(<JobDetail jobId="job-1" />);

    // §5: a skeleton matching the final layout — --muted blocks, marked busy
    // for AT, and never the animate-pulse shimmer or a bare "Loading…" line.
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton!.querySelectorAll(".bg-muted").length).toBeGreaterThan(2);
    expect(skeleton!.querySelector(".animate-pulse")).toBeNull();
    expect(screen.queryByText(/Loading job/)).toBeNull();
  });

  it("shows an error state with retry when the mount load fails — and retry recovers", async () => {
    resultsByTable.jobs = { data: null, error: { message: "Failed to fetch", code: "PGRST301" } };
    render(<JobDetail jobId="job-1" />);

    // §6/§8 DoD: a failed fetch must read as an error with a way forward,
    // never masquerade as "Job not found.".
    expect(await screen.findByText("Couldn't load this job")).toBeTruthy();
    expect(screen.queryByText("Job not found.")).toBeNull();

    // The backend comes back; Try again loads the hub in place.
    resultsByTable.jobs = { data: JOB, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("JOB-1001")).toBeTruthy();
  });

  it("still reads a genuinely missing row (PGRST116) as Job not found", async () => {
    // .single() with zero rows — the job really isn't there, so retrying
    // won't help; the not-found state (with its Back link) is correct.
    resultsByTable.jobs = { data: null, error: { message: "0 rows", code: "PGRST116" } };
    render(<JobDetail jobId="job-1" />);

    expect(await screen.findByText("Job not found.")).toBeTruthy();
    expect(screen.queryByText("Couldn't load this job")).toBeNull();
  });
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

// ── Why this suite exists (#965) ──────────────────────────────────────────
// On a 390px phone the five-entry menu row overflows and scrolls horizontally.
// The bug: `overflow-x-auto` on its own promotes the row's `overflow-y` from
// `visible` to `auto` (CSS spec), so an unconstrained menu also scrolled
// up/down — and without `whitespace-nowrap` the labels could wrap and grow the
// row tall, feeding that vertical scroll. The fix pins scrolling to the x-axis,
// keeps each tab on one line, tightens the spacing, and adds a decorative,
// mobile-only left/right affordance so the horizontal scroll is discoverable.
describe("JobDetail — tab bar scroll affordance (#965)", () => {
  // The scroll container is the flex row that directly holds the tab buttons.
  const tabRow = () => screen.getByRole("button", { name: "Overview" }).parentElement!;

  it("constrains the tab bar to horizontal-only scrolling", async () => {
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    const row = tabRow();
    // Horizontal scroll stays, but vertical is explicitly locked instead of
    // being left to compute to `auto`, and touch is pinned to horizontal pans
    // so a vertical drag can't hijack the row.
    expect(row.className).toContain("overflow-x-auto");
    expect(row.className).toContain("overflow-y-hidden");
    expect(row.className).toContain("touch-pan-x");
  });

  it("keeps each tab on a single line so the row overflows sideways, never taller", async () => {
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // Every entry — the buttons and the Sketch link — must refuse to wrap
    // (`whitespace-nowrap`) and refuse to compress (`shrink-0`); otherwise the
    // labels wrap onto two lines, growing the row tall and re-creating the
    // vertical-scroll bug the container lock is meant to kill.
    for (const entry of [
      screen.getByRole("button", { name: "Overview" }),
      screen.getByRole("button", { name: "Financials" }),
      screen.getByRole("link", { name: /Sketch/ }),
    ]) {
      expect(entry.className).toContain("whitespace-nowrap");
      expect(entry.className).toContain("shrink-0");
    }
  });

  it("places the tab options closer together with tighter horizontal padding", async () => {
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    // "Place the options a bit closer together" (#965): the roomy px-6 gutters
    // tighten to px-4 so the five entries pack in without feeling cramped.
    const overview = screen.getByRole("button", { name: "Overview" });
    expect(overview.className).toContain("px-4");
    expect(overview.className).not.toContain("px-6");
  });

  it("shows decorative, mobile-only left/right scroll hints that bounce", async () => {
    render(<JobDetail jobId="job-1" />);
    expect(await screen.findByText("JOB-1001")).toBeTruthy();

    for (const side of ["left", "right"] as const) {
      const hint = screen.getByTestId(`tab-scroll-hint-${side}`);
      // Pure affordance: announced to no assistive tech and never intercepting
      // the touch that actually scrolls the row.
      expect(hint.getAttribute("aria-hidden")).toBe("true");
      expect(hint.className).toContain("pointer-events-none");
      // Only surfaced at the phone widths where the row overflows and scrolls.
      expect(hint.className).toContain("sm:hidden");
      // It periodically bounces to advertise the horizontal scroll direction.
      expect(hint.querySelector(`.animate-scroll-hint-${side}`)).not.toBeNull();
    }
  });
});
