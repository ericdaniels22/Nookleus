import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import NewTargetDialog from "./new-target-dialog";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockOkResponse(body: unknown = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => body,
  } as Response);
}

describe("NewTargetDialog", () => {
  it("renders the five New Target fields when open", () => {
    render(
      <NewTargetDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    expect(screen.getByLabelText(/company name/i)).toBeDefined();
    expect(screen.getByLabelText(/office phone/i)).toBeDefined();
    expect(screen.getByLabelText(/lead source/i)).toBeDefined();
    expect(screen.getByLabelText(/industry/i)).toBeDefined();
    expect(screen.getByLabelText(/notes/i)).toBeDefined();
  });

  it("submit is disabled until company_name has a non-blank value", () => {
    render(
      <NewTargetDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    const submit = screen.getByRole("button", { name: /add target/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: "Acme Plumbing" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("posts the five fields to /api/referral-partners on submit", async () => {
    mockOkResponse({
      referral_partner: { id: "p-1", status: "grey", company_name: "Acme" },
    });
    render(
      <NewTargetDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: "Acme Plumbing" },
    });
    fireEvent.change(screen.getByLabelText(/office phone/i), {
      target: { value: "555-123-4567" },
    });
    fireEvent.change(screen.getByLabelText(/lead source/i), {
      target: { value: "Google" },
    });
    fireEvent.change(screen.getByLabelText(/industry/i), {
      target: { value: "Plumbing" },
    });
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: "found on yelp" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add target/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/referral-partners");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      company_name: "Acme Plumbing",
      office_phone: "555-123-4567",
      lead_source: "Google",
      industry: "Plumbing",
      notes: "found on yelp",
    });
  });

  it("closes the dialog and notifies the parent on a successful create", async () => {
    mockOkResponse({
      referral_partner: { id: "p-1", status: "grey", company_name: "Acme" },
    });
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <NewTargetDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: "Acme Plumbing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add target/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does NOT close the dialog when the server rejects the create", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "company_name is required" }),
    } as Response);
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <NewTargetDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: "Acme Plumbing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add target/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
