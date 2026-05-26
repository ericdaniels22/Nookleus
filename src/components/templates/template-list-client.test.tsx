import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { EstimateTemplate } from "@/lib/types";

// #284 — The Estimate Templates list page renders with broken `btn`/`btn-sm`/
// `btn-primary` classes that don't exist in the project. These tests pin the
// fix: row actions use the shared <Button> ghost variant, the header CTA
// uses the default solid variant, the filter row is gone, the Inactive pill
// is gone (but the opacity-60 fade stays), and the disabled Duplicate
// tooltip reads "Coming soon".

const navState = vi.hoisted(() => ({
  pushCalls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => navState.pushCalls.push(url),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import TemplateListClient from "./template-list-client";

function makeTemplate(overrides: Partial<EstimateTemplate> = {}): EstimateTemplate {
  return {
    id: "tmpl-1",
    organization_id: "org-1",
    name: "Roof Replacement",
    description: null,
    damage_type_tags: ["wind"],
    opening_statement: null,
    closing_statement: null,
    structure: { sections: [] },
    is_active: true,
    created_by: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

function stubFetch(rows: EstimateTemplate[]) {
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/estimate-templates") && (!init || init.method === undefined || init.method === "GET")) {
      return new Response(JSON.stringify({ rows }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "POST") {
      return new Response(JSON.stringify(makeTemplate({ id: "tmpl-new" })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "DELETE" || init?.method === "PUT") {
      return new Response("{}", {
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

function calledWith(
  fetchSpy: ReturnType<typeof stubFetch>,
  url: string,
  method: string,
): boolean {
  return fetchSpy.mock.calls.some(
    (call) =>
      call[0] === url &&
      (call[1] as RequestInit | undefined)?.method === method,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.pushCalls = [];
});

describe("TemplateListClient — styling fix (#284)", () => {
  it("renders no `className=\"btn ...\"` strings (broken legacy classes are gone)", async () => {
    stubFetch([makeTemplate(), makeTemplate({ id: "tmpl-2", name: "Hail", is_active: false })]);

    const { container } = render(<TemplateListClient />);

    await waitFor(() => {
      expect(screen.getByText("Roof Replacement")).toBeDefined();
    });

    // Walk the rendered DOM and assert no element has a class token that
    // starts with "btn" — that's the broken stylesheet hook.
    const offenders = Array.from(container.querySelectorAll("*")).filter((el) =>
      Array.from(el.classList).some(
        (c) => c === "btn" || c.startsWith("btn-"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("renders the row action buttons via the shared <Button> component (data-slot=\"button\")", async () => {
    stubFetch([makeTemplate()]);

    render(<TemplateListClient />);

    const editLink = await screen.findByRole("link", { name: /edit/i });
    expect(editLink.getAttribute("data-slot")).toBe("button");

    const duplicate = screen.getByRole("button", { name: /duplicate/i });
    expect(duplicate.getAttribute("data-slot")).toBe("button");
  });

  it("renders \"+ New Template\" as the default solid <Button> (primary)", async () => {
    stubFetch([]);

    render(<TemplateListClient />);

    const cta = await screen.findByRole("button", { name: /\+ new template/i });
    expect(cta.getAttribute("data-slot")).toBe("button");
    // Default variant uses bg-primary.
    expect(cta.className).toMatch(/bg-primary/);
  });

  it("does not render the active / inactive / all filter row", async () => {
    stubFetch([makeTemplate()]);

    render(<TemplateListClient />);

    await screen.findByText("Roof Replacement");

    // The legacy filter row rendered three buttons named exactly "active",
    // "inactive", "all". None should exist post-#284.
    expect(screen.queryByRole("button", { name: /^active$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^inactive$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^all$/i })).toBeNull();
  });

  it("does not render the Inactive pill on inactive cards but keeps the opacity-60 fade", async () => {
    stubFetch([makeTemplate({ id: "tmpl-2", name: "Hail", is_active: false })]);

    const { container } = render(<TemplateListClient />);

    await screen.findByText("Hail");

    // The pill rendered the literal text "Inactive" in a styled span.
    expect(screen.queryByText("Inactive")).toBeNull();

    // The card still fades via opacity-60.
    const card = container.querySelector(".opacity-60");
    expect(card).not.toBeNull();
  });

  it("disabled Duplicate uses tooltip text \"Coming soon\"", async () => {
    stubFetch([makeTemplate()]);

    render(<TemplateListClient />);

    const duplicate = await screen.findByRole("button", { name: /duplicate/i });
    expect(duplicate.getAttribute("title")).toBe("Coming soon");
    expect((duplicate as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TemplateListClient — inline Active checkbox (#285)", () => {
  it("renders an inline 'Active' checkbox per card, checked when is_active", async () => {
    stubFetch([makeTemplate({ id: "tmpl-1", name: "Roof Replacement", is_active: true })]);

    render(<TemplateListClient />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: /active/i,
    })) as HTMLInputElement;
    expect(checkbox.type).toBe("checkbox");
    expect(checkbox.checked).toBe(true);
  });

  it("renders the checkbox unchecked when is_active is false", async () => {
    stubFetch([makeTemplate({ id: "tmpl-2", name: "Hail", is_active: false })]);

    render(<TemplateListClient />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: /active/i,
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("no longer renders Deactivate or Reactivate buttons", async () => {
    stubFetch([
      makeTemplate({ id: "tmpl-1" }),
      makeTemplate({ id: "tmpl-2", name: "Hail", is_active: false }),
    ]);

    render(<TemplateListClient />);

    await screen.findByText("Roof Replacement");

    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
  });

  it("toggling an active card's checkbox PUTs { is_active: false }", async () => {
    const fetchSpy = stubFetch([makeTemplate({ id: "tmpl-1", is_active: true })]);

    render(<TemplateListClient />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: /active/i,
    })) as HTMLInputElement;

    fireEvent.click(checkbox);

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) =>
          c[0] === "/api/estimate-templates/tmpl-1" &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(
        (putCall![1] as RequestInit).body as string,
      ) as { is_active: boolean };
      expect(body.is_active).toBe(false);
    });
  });

  it("toggling an inactive card's checkbox PUTs { is_active: true }", async () => {
    const fetchSpy = stubFetch([
      makeTemplate({ id: "tmpl-2", name: "Hail", is_active: false }),
    ]);

    render(<TemplateListClient />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: /active/i,
    })) as HTMLInputElement;

    fireEvent.click(checkbox);

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) =>
          c[0] === "/api/estimate-templates/tmpl-2" &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(
        (putCall![1] as RequestInit).body as string,
      ) as { is_active: boolean };
      expect(body.is_active).toBe(true);
    });
  });

  it("after toggling an active card off, the card gains the opacity-60 fade without a reload", async () => {
    stubFetch([makeTemplate({ id: "tmpl-1", is_active: true })]);

    const { container } = render(<TemplateListClient />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: /active/i,
    })) as HTMLInputElement;

    expect(container.querySelector(".opacity-60")).toBeNull();

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(container.querySelector(".opacity-60")).not.toBeNull();
    });
  });
});

describe("TemplateListClient — behavior unchanged (regression guards)", () => {
  it("+ New Template POSTs and pushes the edit route for the new template", async () => {
    const fetchSpy = stubFetch([]);

    render(<TemplateListClient />);

    fireEvent.click(await screen.findByRole("button", { name: /\+ new template/i }));

    await waitFor(() => {
      expect(calledWith(fetchSpy, "/api/estimate-templates", "POST")).toBe(true);
    });

    await waitFor(() => {
      expect(navState.pushCalls).toContain(
        "/settings/estimate-templates/tmpl-new/edit",
      );
    });
  });

  it("Edit link points to the per-template edit route", async () => {
    stubFetch([makeTemplate({ id: "tmpl-1" })]);

    render(<TemplateListClient />);

    const editLink = await screen.findByRole("link", { name: /edit/i });
    expect(editLink.getAttribute("href")).toBe(
      "/settings/estimate-templates/tmpl-1/edit",
    );
  });
});
