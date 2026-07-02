import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Payment } from "@/lib/types";
import BillingSection from "./billing-section";

// The Online Payment Requests subsection fetches on mount; stub fetch so the
// Billing surface renders without a network and settles to its empty branch.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ payment_requests: [] }),
  }) as unknown as typeof fetch;
});

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_id: null,
    source: "insurance",
    method: "check",
    amount: 500,
    reference_number: null,
    payer_name: null,
    status: "received",
    notes: null,
    received_date: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

// §2.8 money-path reskin (#917): the Billing surface tags each payment with a
// source + status badge. Both must render the §2.6 dark-tint treatment from the
// shared resolvers — never the old light hex boxes (bg-[#E1F5EE] …) that read as
// bright cards on the dark canvas.
describe("BillingSection payment badges (#917)", () => {
  it("renders the source badge with its §2.6 dark tint, not a light hex box", () => {
    render(
      <BillingSection
        jobId="job-1"
        payments={[makePayment({ source: "insurance" })]}
        onPaymentRecorded={() => {}}
      />,
    );
    const badge = screen.getByText("insurance");
    expect(badge.className).toContain("text-emerald-300");
    expect(badge.className).toContain("bg-emerald-500/14");
    expect(badge.className).not.toContain("bg-[#");
  });

  it("renders each status badge with its semantic dark tint", () => {
    render(
      <BillingSection
        jobId="job-1"
        payments={[
          makePayment({ id: "p1", source: "insurance", status: "received" }),
          makePayment({ id: "p2", source: "homeowner", status: "pending" }),
          makePayment({ id: "p3", source: "other", status: "due" }),
        ]}
        onPaymentRecorded={() => {}}
      />,
    );
    expect(screen.getByText("received").className).toContain("text-emerald-300");
    expect(screen.getByText("pending").className).toContain("text-amber-400");
    expect(screen.getByText("due").className).toContain("text-[#F09595]");
  });

  it("leaves no legacy light-hex badge box in the rendered surface", () => {
    const { container } = render(
      <BillingSection
        jobId="job-1"
        payments={[
          makePayment({ id: "p1", source: "insurance", status: "received" }),
          makePayment({ id: "p2", source: "homeowner", status: "received" }),
        ]}
        onPaymentRecorded={() => {}}
      />,
    );
    // The old light-mode source/status tints and progress-bar fills are gone.
    for (const hex of ["#E1F5EE", "#E6F1FB", "#F1EFE8", "#FAEEDA", "#FCEBEB", "#2B5EA7"]) {
      expect(container.innerHTML).not.toContain(hex);
    }
  });
});
