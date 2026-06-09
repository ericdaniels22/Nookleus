import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

import { NewEstimateModal } from "./new-estimate-modal";

// The modal owns its data fetching (like PaymentRequestModal): on open it
// loads the org's standard Estimate title and the active template list, then
// posts the create to the single create-with-template endpoint. Tests stub
// global fetch with a URL router.

interface TemplateRow {
  id: string;
  name: string;
  damage_type_tags: string[];
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

/** Route the modal's fetches by URL; unexpected URLs fail the test loudly. */
function stubApi({
  defaultTitle = "Estimate",
  templates = [] as TemplateRow[],
  create = () => jsonResponse({ id: "est-1" }, true, 201),
}: {
  defaultTitle?: string;
  templates?: TemplateRow[];
  create?: () => Response | Promise<Response>;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/estimates/default-title")) {
      return jsonResponse({ title: defaultTitle });
    }
    if (url.startsWith("/api/estimate-templates")) {
      return jsonResponse({ rows: templates });
    }
    if (url === "/api/estimates/create-with-template") {
      return create();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function createCalls() {
  return fetchMock.mock.calls.filter(
    ([url]) => url === "/api/estimates/create-with-template",
  );
}

function renderModal(overrides: Partial<Parameters<typeof NewEstimateModal>[0]> = {}) {
  return render(
    <NewEstimateModal
      open
      onOpenChange={() => {}}
      jobId="job-1"
      jobDamageType={null}
      onCreated={() => {}}
      {...overrides}
    />,
  );
}

describe("NewEstimateModal", () => {
  it("seeds the name field with the Organization's standard title and defaults the picker to No template", async () => {
    stubApi({ defaultTitle: "Scope of Work" });
    renderModal();

    const name = (await screen.findByLabelText(/estimate name/i)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Scope of Work"));

    const picker = screen.getByLabelText(/template/i) as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(
      within(picker).getByRole("option", { name: /no template/i }),
    ).toBeDefined();
  });

  it("floats templates whose damage type matches the Job to the top of the picker", async () => {
    stubApi({
      templates: [
        { id: "t-fire", name: "Fire Restoration", damage_type_tags: ["fire"] },
        { id: "t-water", name: "Water Mitigation", damage_type_tags: ["water"] },
        { id: "t-blank", name: "Blank Sections", damage_type_tags: [] },
      ],
    });
    renderModal({ jobDamageType: "water" });

    const picker = (await screen.findByLabelText(/template/i)) as HTMLSelectElement;
    await waitFor(() =>
      expect(within(picker).getAllByRole("option")).toHaveLength(4),
    );

    const labels = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual([
      "No template",
      "Water Mitigation",
      "Fire Restoration",
      "Blank Sections",
    ]);
  });

  it("posts job_id, the edited title, and the picked template on submit", async () => {
    stubApi({
      defaultTitle: "Scope of Work",
      templates: [
        { id: "t-water", name: "Water Mitigation", damage_type_tags: ["water"] },
      ],
    });
    renderModal({ jobId: "job-42" });

    const name = (await screen.findByLabelText(/estimate name/i)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Scope of Work"));
    fireEvent.change(name, { target: { value: "Roof Replacement" } });

    const picker = screen.getByLabelText(/template/i) as HTMLSelectElement;
    await waitFor(() =>
      expect(within(picker).getAllByRole("option")).toHaveLength(2),
    );
    fireEvent.change(picker, { target: { value: "t-water" } });

    fireEvent.click(screen.getByRole("button", { name: /create estimate/i }));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const [, init] = createCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      job_id: "job-42",
      title: "Roof Replacement",
      template_id: "t-water",
    });
  });

  it("posts template_id null when No template is kept", async () => {
    stubApi({ defaultTitle: "Scope of Work" });
    renderModal({ jobId: "job-42" });

    const name = (await screen.findByLabelText(/estimate name/i)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Scope of Work"));

    fireEvent.click(screen.getByRole("button", { name: /create estimate/i }));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const [, init] = createCalls()[0];
    expect(JSON.parse(init.body)).toEqual({
      job_id: "job-42",
      title: "Scope of Work",
      template_id: null,
    });
  });

  it("hands the new estimate id to onCreated and closes on success", async () => {
    stubApi({ create: () => jsonResponse({ id: "est-99" }, true, 201) });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ onCreated, onOpenChange });

    await screen.findByLabelText(/estimate name/i);
    fireEvent.click(screen.getByRole("button", { name: /create estimate/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("est-99"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables the submit button and shows Creating… while the create is in flight", async () => {
    let release!: (r: Response) => void;
    stubApi({
      create: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    renderModal();

    await screen.findByLabelText(/estimate name/i);
    fireEvent.click(screen.getByRole("button", { name: /create estimate/i }));

    const pending = (await screen.findByRole("button", {
      name: /creating…/i,
    })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    release(jsonResponse({ id: "est-1" }, true, 201));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /create estimate/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("shows the server error, stays open, and re-enables submit when the create fails", async () => {
    stubApi({
      create: () => jsonResponse({ error: "job_not_found" }, false, 404),
    });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ onCreated, onOpenChange });

    await screen.findByLabelText(/estimate name/i);
    fireEvent.click(screen.getByRole("button", { name: /create estimate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/job_not_found/);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      (screen.getByRole("button", { name: /create estimate/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
