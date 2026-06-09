// Issue #543 — Estimate Builder full-width layout: settings chrome escape.
//
// The template editor lives under /settings/estimate-templates/[id]/edit, so it
// is wrapped by SettingsLayout — which normally constrains its children to a
// `max-w-6xl` column beside the "Settings" header and the settings sub-nav. For
// the template editing mode to render full-width in the new BuilderLayout shell
// (the same way estimate/invoice modes do), the layout must step out of the way
// on that one route and render the builder bare, while leaving every other
// settings page wrapped exactly as before.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/settings/company" as string },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import SettingsLayout from "./layout";

beforeEach(() => {
  pathnameRef.current = "/settings/company";
});

describe("SettingsLayout — full-width escape on the template editor (#543)", () => {
  it("renders the template editor bare, without the settings chrome", () => {
    pathnameRef.current = "/settings/estimate-templates/tmpl-1/edit";
    render(
      <SettingsLayout>
        <div>builder-marker</div>
      </SettingsLayout>,
    );

    // The builder content is present …
    expect(screen.getByText("builder-marker")).toBeDefined();
    // … but the settings chrome (header + narrow column + sub-nav) is gone.
    expect(screen.queryByText("Settings")).toBeNull();
    expect(document.querySelector(".max-w-6xl")).toBeNull();
  });

  it("keeps the settings chrome on every other settings page", () => {
    pathnameRef.current = "/settings/company";
    render(
      <SettingsLayout>
        <div>page-marker</div>
      </SettingsLayout>,
    );

    expect(screen.getByText("page-marker")).toBeDefined();
    // Ordinary settings pages still get the header + narrow column wrapper.
    expect(screen.getByText("Settings")).toBeDefined();
    expect(document.querySelector(".max-w-6xl")).not.toBeNull();
  });
});
