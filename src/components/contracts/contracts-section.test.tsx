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

function stubFetch(rows: ContractListItem[] = [makeDraftRow()]) {
  const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
    void _init;
    if (url.includes("/api/contracts/by-job/")) {
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function calledDelete(
  fetchSpy: ReturnType<typeof stubFetch>,
  url: string,
): boolean {
  return fetchSpy.mock.calls.some(
    (call) => call[0] === url && (call[1] as RequestInit | undefined)?.method === "DELETE",
  );
}

function calledPost(
  fetchSpy: ReturnType<typeof stubFetch>,
  url: string,
): boolean {
  return fetchSpy.mock.calls.some(
    (call) => call[0] === url && (call[1] as RequestInit | undefined)?.method === "POST",
  );
}

function makeVoidedRow(
  overrides: Partial<ContractListItem> = {},
): ContractListItem {
  return makeDraftRow({
    status: "voided",
    sent_at: "2026-05-13T10:00:00Z",
    void_reason: "wrong customer",
    ...overrides,
  });
}

describe("ContractsSection three-dot menu — Delete draft (#61)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames the draft menu item to 'Delete draft' and dispatches DELETE on confirm", async () => {
    const fetchSpy = stubFetch();

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

    // Pre-#61 label was "Discard draft"; #61 renames it.
    const deleteMenuItem = await screen.findByRole("button", {
      name: /delete draft/i,
    });

    fireEvent.mouseDown(deleteMenuItem);
    fireEvent.click(deleteMenuItem);

    // Light confirmation dialog appears. No action has been dispatched yet.
    const confirmBtn = await screen.findByRole("button", {
      name: /^delete$/i,
    });
    expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(false);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(true);
    });
  });

  it("dismisses the confirmation dialog with Cancel and does not call DELETE", async () => {
    const fetchSpy = stubFetch();

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
    const deleteMenuItem = await screen.findByRole("button", {
      name: /delete draft/i,
    });
    fireEvent.mouseDown(deleteMenuItem);
    fireEvent.click(deleteMenuItem);

    const cancelBtn = await screen.findByRole("button", {
      name: /cancel/i,
    });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    });

    expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(false);
  });
});

describe("ContractsSection three-dot menu — Permanently delete voided (#63)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows BOTH 'Restore' and 'Permanently delete' on a voided row, and opens a confirm dialog (no DELETE fired yet)", async () => {
    const fetchSpy = stubFetch([makeVoidedRow()]);

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

    expect(
      await screen.findByRole("button", { name: /^restore$/i }),
    ).toBeDefined();
    const permDeleteItem = await screen.findByRole("button", {
      name: /permanently delete/i,
    });

    fireEvent.click(permDeleteItem);

    // Light confirmation must appear; no DELETE fired before confirmation.
    const confirmBtn = await screen.findByRole("button", {
      name: /^delete$/i,
    });
    expect(confirmBtn).toBeDefined();
    expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(false);
  });

  it("fires DELETE /api/contracts/[id] after confirming the dialog", async () => {
    const fetchSpy = stubFetch([makeVoidedRow()]);

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
    fireEvent.click(
      await screen.findByRole("button", { name: /permanently delete/i }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(true);
    });
  });

  it("dismisses the confirmation dialog with Cancel and does not call DELETE", async () => {
    const fetchSpy = stubFetch([makeVoidedRow()]);

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
    fireEvent.click(
      await screen.findByRole("button", { name: /permanently delete/i }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    });
    expect(calledDelete(fetchSpy, "/api/contracts/c-1")).toBe(false);
  });
});

describe("ContractsSection three-dot menu — Restore voided (#62)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the ⋯ menu on a voided row and fires POST /restore on click with no confirmation", async () => {
    const fetchSpy = stubFetch([makeVoidedRow()]);

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

    // The ⋯ menu must render on voided rows (the {!isVoided && ...} gate
    // is removed by #62).
    const menuToggle = screen.getByRole("button", { name: /row actions/i });
    fireEvent.click(menuToggle);

    // Voided menu shows a single "Restore" action.
    const restoreItem = await screen.findByRole("button", {
      name: /restore/i,
    });

    // Per #62: one click, no confirmation dialog — fires the request directly.
    fireEvent.click(restoreItem);

    await waitFor(() => {
      expect(calledPost(fetchSpy, "/api/contracts/c-1/restore")).toBe(true);
    });

    // No confirm dialog should have rendered.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
