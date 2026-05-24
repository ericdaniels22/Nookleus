import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// #234 — OutgoingEmailEditor is the single deep module that powers the
// Invoices / Contracts / Payment links tabs under /settings/outgoing.
// Public interface: <OutgoingEmailEditor kind="invoice" | "contract" | "payment-link" />.
// Tests pin the kind-specific endpoint, the load → edit → save round trip,
// and the dirty-tracking that gates the Save button. The Tiptap-based template
// fields are mocked because they don't render meaningfully in jsdom and the
// shell's behavior is what we care about here.

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/contracts/email-template-field", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/components/settings/payment-email-template-field", () => ({
  __esModule: true,
  default: () => null,
}));

import { OutgoingEmailEditor } from "./outgoing-email-editor";

interface FetchedRequest {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(responses: Record<string, unknown>) {
  const calls: FetchedRequest[] = [];
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    const payload = responses[url];
    if (payload === undefined) {
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return calls;
}

function invoiceSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "ies-1",
    provider: "resend" as const,
    email_account_id: null,
    send_from_email: "billing@example.com",
    send_from_name: "Example Billing",
    reply_to_email: null,
    subject_template: "Invoice {{invoice_number}}",
    body_template: "Hello",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function contractSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "ces-1",
    send_from_email: "contracts@example.com",
    send_from_name: "Example Contracts",
    reply_to_email: null,
    provider: "resend" as const,
    email_account_id: null,
    signing_request_subject_template: "Please sign",
    signing_request_body_template: "Sign please",
    signed_confirmation_subject_template: "Thanks",
    signed_confirmation_body_template: "Thanks for signing",
    signed_confirmation_internal_subject_template: "Signed!",
    signed_confirmation_internal_body_template: "A contract was signed",
    reminder_subject_template: "Reminder",
    reminder_body_template: "Sign please",
    reminder_day_offsets: [1, 3],
    default_link_expiry_days: 14,
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function paymentSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "pes-1",
    send_from_email: "payments@example.com",
    send_from_name: "Example Payments",
    reply_to_email: null,
    provider: "resend" as const,
    email_account_id: null,
    payment_request_subject_template: "Pay here",
    payment_request_body_template: "Body",
    payment_reminder_subject_template: "Reminder",
    payment_reminder_body_template: "Body",
    reminder_day_offsets: [3, 7],
    default_link_expiry_days: 14,
    fee_disclosure_text: null,
    updated_at: "2026-05-01T00:00:00Z",
    payment_receipt_subject_template: "Receipt",
    payment_receipt_body_template: "Body",
    refund_confirmation_subject_template: "Refunded",
    refund_confirmation_body_template: "Body",
    payment_received_internal_subject_template: "Internal",
    payment_received_internal_body_template: "Body",
    payment_failed_internal_subject_template: "Failed",
    payment_failed_internal_body_template: "Body",
    refund_issued_internal_subject_template: "Refund issued",
    refund_issued_internal_body_template: "Body",
    internal_notification_to_email: null,
    estimate_send_subject_template: "Estimate",
    estimate_send_body_template: "Body",
    invoice_send_subject_template: "Invoice",
    invoice_send_body_template: "Body",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutgoingEmailEditor — invoice kind", () => {
  it("loads /api/settings/invoice-email on mount and populates the send-from email field", async () => {
    stubFetch({
      "/api/settings/invoice-email": invoiceSettings({
        send_from_email: "ar@acme.test",
      }),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="invoice" />);

    const input = await screen.findByDisplayValue("ar@acme.test");
    expect(input).toBeDefined();
  });

  it("disables Save until a field is edited (dirty tracking)", async () => {
    stubFetch({
      "/api/settings/invoice-email": invoiceSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="invoice" />);

    const saveBtn = (await screen.findByRole("button", {
      name: /save/i,
    })) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const fromEmail = (await screen.findByDisplayValue(
      "billing@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "new@example.com" } });

    expect(saveBtn.disabled).toBe(false);
  });

  it("PATCHes /api/settings/invoice-email with the edited payload on Save", async () => {
    const calls = stubFetch({
      "/api/settings/invoice-email": invoiceSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="invoice" />);

    const fromEmail = (await screen.findByDisplayValue(
      "billing@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "ar@acme.test" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const save = calls.find(
        (c) =>
          c.url === "/api/settings/invoice-email" && c.method === "PATCH",
      );
      expect(save).toBeDefined();
      expect((save!.body as Record<string, unknown>).send_from_email).toBe(
        "ar@acme.test",
      );
    });
  });
});

describe("OutgoingEmailEditor — contract kind", () => {
  it("loads /api/settings/contract-email on mount and populates the send-from email field", async () => {
    stubFetch({
      "/api/settings/contract-email": contractSettings({
        send_from_email: "deals@acme.test",
      }),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="contract" />);

    expect(await screen.findByDisplayValue("deals@acme.test")).toBeDefined();
  });

  it("disables Save until a field is edited", async () => {
    stubFetch({
      "/api/settings/contract-email": contractSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="contract" />);

    const saveBtn = (await screen.findByRole("button", {
      name: /save/i,
    })) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const fromEmail = (await screen.findByDisplayValue(
      "contracts@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "new@example.com" } });

    expect(saveBtn.disabled).toBe(false);
  });

  it("PATCHes /api/settings/contract-email with the edited payload on Save", async () => {
    const calls = stubFetch({
      "/api/settings/contract-email": contractSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="contract" />);

    const fromEmail = (await screen.findByDisplayValue(
      "contracts@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "deals@acme.test" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const save = calls.find(
        (c) =>
          c.url === "/api/settings/contract-email" && c.method === "PATCH",
      );
      expect(save).toBeDefined();
      expect((save!.body as Record<string, unknown>).send_from_email).toBe(
        "deals@acme.test",
      );
    });
  });
});

describe("OutgoingEmailEditor — payment-link kind", () => {
  it("loads /api/settings/payment-email on mount and populates the send-from email field", async () => {
    stubFetch({
      "/api/settings/payment-email": paymentSettings({
        send_from_email: "pay@acme.test",
      }),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="payment-link" />);

    expect(await screen.findByDisplayValue("pay@acme.test")).toBeDefined();
  });

  it("disables Save until a field is edited", async () => {
    stubFetch({
      "/api/settings/payment-email": paymentSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="payment-link" />);

    const saveBtn = (await screen.findByRole("button", {
      name: /save/i,
    })) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const fromEmail = (await screen.findByDisplayValue(
      "payments@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "new@example.com" } });

    expect(saveBtn.disabled).toBe(false);
  });

  it("PATCHes /api/settings/payment-email with the edited payload on Save", async () => {
    const calls = stubFetch({
      "/api/settings/payment-email": paymentSettings(),
      "/api/email/accounts": [],
    });

    render(<OutgoingEmailEditor kind="payment-link" />);

    const fromEmail = (await screen.findByDisplayValue(
      "payments@example.com",
    )) as HTMLInputElement;
    fireEvent.change(fromEmail, { target: { value: "pay@acme.test" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const save = calls.find(
        (c) =>
          c.url === "/api/settings/payment-email" && c.method === "PATCH",
      );
      expect(save).toBeDefined();
      expect((save!.body as Record<string, unknown>).send_from_email).toBe(
        "pay@acme.test",
      );
    });
  });
});
