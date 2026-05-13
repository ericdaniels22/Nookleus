import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ContractListItem } from "@/lib/contracts/types";

vi.mock("./send-contract-modal", () => ({ default: () => null }));
vi.mock("./sign-in-person-modal", () => ({ default: () => null }));
vi.mock("./void-contract-dialog", () => ({ default: () => null }));
vi.mock("./download-pdf-button", () => ({ default: () => null }));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import ContractsSection from "./contracts-section";

function makeDraftRow(overrides: Partial<ContractListItem> = {}): ContractListItem {
  return {
    id: "c-1",
    title: "Roof Replacement Agreement",
    status: "draft",
    sent_at: null,
    first_viewed_at: null,
    signed_at: null,
    link_expires_at: null,
    void_reason: null,
    signed_pdf_path: null,
    primary_signer_name: null,
    primary_signer_ip: null,
    signer_count: 1,
    signers: [],
    reminder_count: 0,
    next_reminder_at: null,
    created_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

describe("ContractsSection three-dot menu", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/api/contracts/by-job/")) {
        return new Response(JSON.stringify([makeDraftRow()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Catch-all for any action endpoint the menu items may hit.
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("fires the menu-item handler when the user clicks Discard draft (mousedown + click)", async () => {
    render(
      <ContractsSection
        jobId="job-1"
        customerEmail={null}
        customerName={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Roof Replacement Agreement")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /row actions/i }));

    const discard = await screen.findByRole("button", { name: /discard draft/i });

    // Simulate a real user click sequence — mousedown, then click. The
    // pre-fix bug is that a doc-level `mousedown` listener closes the menu
    // before the click can land on the button. After the fix the menu
    // stays open through the click and the handler runs.
    fireEvent.mouseDown(discard);
    fireEvent.click(discard);

    await waitFor(() => {
      const hitVoid = fetchSpy.mock.calls.some(
        ([url]: [string]) => url === "/api/contracts/c-1/void",
      );
      expect(hitVoid).toBe(true);
    });
  });
});
