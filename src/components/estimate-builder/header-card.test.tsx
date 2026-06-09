// HeaderCard (#574) — one compact card consolidating the document's identity
// (back link, number badge, status badge, editable title, save indicator,
// actions, Export PDF) with the mode-branched date/PO fields that used to live
// in a separate MetadataBar strip. Estimate → Date of issue + Valid until;
// Invoice → Date of issue + Due date + PO number; template → no dates/status.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { HeaderCard } from "./header-card";
import type {
  BuilderEntity,
  EstimateWithContents,
  InvoiceWithContents,
  TemplateWithContents,
} from "@/lib/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Partial objects cast to the full WithContents shapes — HeaderCard only reads
// the identity scalars (id, number, title/name, status, dates, job_id).

function makeEstimate(
  overrides: Partial<EstimateWithContents> = {},
): BuilderEntity {
  return {
    kind: "estimate",
    data: {
      id: "est-1",
      job_id: "job-1",
      estimate_number: "EST-24-001",
      title: "Water mitigation — main floor",
      status: "draft",
      issued_date: null,
      valid_until: null,
      updated_at: "2026-06-01T00:00:00Z",
      sections: [],
      ...overrides,
    } as unknown as EstimateWithContents,
  };
}

function makeInvoice(
  overrides: Partial<InvoiceWithContents> = {},
): BuilderEntity {
  return {
    kind: "invoice",
    data: {
      id: "inv-1",
      job_id: "job-1",
      invoice_number: "INV-24-001",
      title: "Water mitigation — main floor",
      status: "draft",
      issued_date: null,
      due_date: null,
      po_number: null,
      converted_from_estimate_id: null,
      updated_at: "2026-06-01T00:00:00Z",
      sections: [],
      ...overrides,
    } as unknown as InvoiceWithContents,
  };
}

function makeTemplate(
  overrides: Partial<TemplateWithContents> = {},
): BuilderEntity {
  return {
    kind: "template",
    data: {
      id: "tpl-1",
      name: "Water mitigation starter",
      description: null,
      damage_type_tags: [],
      updated_at: "2026-06-01T00:00:00Z",
      sections: [],
      ...overrides,
    } as unknown as TemplateWithContents,
  };
}

const noop = () => {};

function renderCard(
  entity: BuilderEntity,
  props: Partial<ComponentProps<typeof HeaderCard>> = {},
) {
  return render(
    <HeaderCard
      entity={entity}
      onTitleChange={noop}
      onVoid={noop}
      saveStatus="idle"
      lastSavedAt={null}
      isVoiding={false}
      onIssuedDateChange={noop}
      onValidUntilChange={noop}
      {...props}
    />,
  );
}

// ── One card: identity + dates together ──────────────────────────────────────

describe("HeaderCard — estimate identity and dates live in one card", () => {
  it("renders the number badge, status badge, title, Date of issue, and Valid until inside a single card element", () => {
    const { container } = renderCard(
      makeEstimate({ issued_date: "2026-06-01", valid_until: "2026-07-01" }),
    );

    // Everything below is found *within the first rendered element* — the
    // consolidated card — not spread across sibling strips.
    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();

    expect(within(card).getByText("EST-24-001")).toBeDefined();
    expect(within(card).getByText("Draft")).toBeDefined();
    expect(
      within(card).getByText("Water mitigation — main floor"),
    ).toBeDefined();

    const issued = within(card).getByLabelText(/date of issue/i) as HTMLInputElement;
    const validUntil = within(card).getByLabelText(/valid until/i) as HTMLInputElement;
    expect(issued.value).toBe("2026-06-01");
    expect(validUntil.value).toBe("2026-07-01");

    // Nothing rendered outside the card (no second strip).
    expect(screen.getAllByText(/date of issue/i)).toHaveLength(1);
  });
});

// ── Date edits ────────────────────────────────────────────────────────────────

describe("HeaderCard — estimate date edits", () => {
  it("fires onIssuedDateChange / onValidUntilChange with the picked date, and null when cleared", () => {
    const onIssuedDateChange = vi.fn();
    const onValidUntilChange = vi.fn();
    renderCard(
      makeEstimate({ issued_date: "2026-06-01", valid_until: "2026-07-01" }),
      { onIssuedDateChange, onValidUntilChange },
    );

    fireEvent.change(screen.getByLabelText(/date of issue/i), {
      target: { value: "2026-06-15" },
    });
    expect(onIssuedDateChange).toHaveBeenCalledWith("2026-06-15");

    fireEvent.change(screen.getByLabelText(/valid until/i), {
      target: { value: "" },
    });
    expect(onValidUntilChange).toHaveBeenCalledWith(null);
  });

  it("disables both date inputs when the estimate is voided", () => {
    renderCard(makeEstimate({ status: "voided" }));

    expect(screen.getByLabelText(/date of issue/i)).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText(/valid until/i)).toHaveProperty(
      "disabled",
      true,
    );
  });
});

// ── Invoice mode ──────────────────────────────────────────────────────────────

describe("HeaderCard — invoice fields", () => {
  it("shows Date of issue, Due date, and PO number (no Valid until); PO edits fire onPoNumberChange", () => {
    const onPoNumberChange = vi.fn();
    renderCard(
      makeInvoice({ issued_date: "2026-06-01", due_date: "2026-06-30" }),
      { onDueDateChange: noop, onPoNumberChange },
    );

    expect(
      (screen.getByLabelText(/date of issue/i) as HTMLInputElement).value,
    ).toBe("2026-06-01");
    expect(
      (screen.getByLabelText(/due date/i) as HTMLInputElement).value,
    ).toBe("2026-06-30");
    expect(screen.queryByLabelText(/valid until/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/po number/i), {
      target: { value: "PO-7781" },
    });
    expect(onPoNumberChange).toHaveBeenCalledWith("PO-7781");
  });

  it("disables the date and PO inputs when the invoice is paid", () => {
    renderCard(makeInvoice({ status: "paid" }), {
      onDueDateChange: noop,
      onPoNumberChange: noop,
    });

    expect(screen.getByLabelText(/date of issue/i)).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText(/due date/i)).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(/po number/i)).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("links back to the source estimate when converted_from_estimate_id is set", () => {
    renderCard(
      makeInvoice({ converted_from_estimate_id: "est-9" }),
      { onDueDateChange: noop, onPoNumberChange: noop },
    );

    const link = screen.getByRole("link", { name: /from estimate/i });
    expect(link.getAttribute("href")).toBe("/estimates/est-9");
  });
});

// ── Template mode ─────────────────────────────────────────────────────────────

describe("HeaderCard — template mode", () => {
  it("shows the template name and a Save Template action, with no dates and no status badge", () => {
    const onSaveTemplate = vi.fn();
    renderCard(makeTemplate(), { onSaveTemplate });

    expect(screen.getByText("Water mitigation starter")).toBeDefined();
    expect(screen.queryByLabelText(/date of issue/i)).toBeNull();
    expect(screen.queryByLabelText(/valid until/i)).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /save template/i }));
    expect(onSaveTemplate).toHaveBeenCalled();
  });

  it("links back to the templates list", () => {
    renderCard(makeTemplate());

    const back = screen.getByRole("link", { name: /back to templates/i });
    expect(back.getAttribute("href")).toBe("/settings/estimate-templates");
  });
});

// ── Estimate actions ──────────────────────────────────────────────────────────
// Status is driven by actions; there is no status-picker dropdown (#567/#574).

describe("HeaderCard — estimate actions by status", () => {
  it("draft: offers Mark as Sent, Convert to Invoice, Void, and Export PDF — and no status dropdown", () => {
    renderCard(makeEstimate(), { onConvertClick: noop });

    expect(
      screen.getByRole("button", { name: /mark as sent/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /convert to invoice/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /^void$/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /export pdf/i }),
    ).toBeDefined();

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("sent: Mark as Sent disappears; Convert and Void remain", () => {
    renderCard(makeEstimate({ status: "sent" }), { onConvertClick: noop });

    expect(screen.queryByRole("button", { name: /mark as sent/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /convert to invoice/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /^void$/i })).toBeDefined();
  });

  it("voided: only Export PDF remains", () => {
    renderCard(makeEstimate({ status: "voided" }), { onConvertClick: noop });

    expect(screen.queryByRole("button", { name: /mark as sent/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /convert to invoice/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^void$/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /export pdf/i }),
    ).toBeDefined();
  });

  it("Mark as Sent PUTs the status transition with the optimistic-lock snapshot", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    renderCard(makeEstimate(), { onConvertClick: noop });
    fireEvent.click(screen.getByRole("button", { name: /mark as sent/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/estimates/est-1/status",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      status: "sent",
      updated_at_snapshot: "2026-06-01T00:00:00Z",
    });

    vi.unstubAllGlobals();
  });
});

// ── In-place title editing ────────────────────────────────────────────────────

describe("HeaderCard — in-place title edit", () => {
  it("one click turns the title into an input; Enter commits the trimmed value", () => {
    const onTitleChange = vi.fn();
    renderCard(makeEstimate(), { onTitleChange });

    fireEvent.click(screen.getByText("Water mitigation — main floor"));

    const input = screen.getByDisplayValue(
      "Water mitigation — main floor",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Sewage cleanup — basement  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onTitleChange).toHaveBeenCalledWith("Sewage cleanup — basement");
  });

  it("Escape cancels the edit without firing onTitleChange", () => {
    const onTitleChange = vi.fn();
    renderCard(makeEstimate(), { onTitleChange });

    fireEvent.click(screen.getByText("Water mitigation — main floor"));

    const input = screen.getByDisplayValue(
      "Water mitigation — main floor",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Something else" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.getByText("Water mitigation — main floor")).toBeDefined();
  });
});

// ── Invoice actions (unchanged behavior) ──────────────────────────────────────

describe("HeaderCard — invoice actions by status", () => {
  it("draft: Mark as Sent PUTs the invoice status transition", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    renderCard(makeInvoice());
    fireEvent.click(screen.getByRole("button", { name: /mark as sent/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/invoices/inv-1/status",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body as string).status,
    ).toBe("sent");

    vi.unstubAllGlobals();
  });

  it("sent: offers Mark as Paid; paid: offers Unmark Paid", () => {
    const { unmount } = renderCard(makeInvoice({ status: "sent" }));
    expect(
      screen.getByRole("button", { name: /mark as paid/i }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /mark as sent/i })).toBeNull();
    unmount();

    renderCard(makeInvoice({ status: "paid" }));
    expect(
      screen.getByRole("button", { name: /unmark paid/i }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /mark as paid/i })).toBeNull();
  });
});
