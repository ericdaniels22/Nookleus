import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #234 — smoke test for the combined /settings/outgoing shell. The three
// tab bodies are integration-tested in outgoing-email-editor.test.tsx; this
// only verifies that the shell wires up the three expected tabs in the right
// order (Invoices first as the default) and renders without crashing.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/outgoing",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/settings/outgoing-email-editor", () => ({
  OutgoingEmailEditor: ({ kind }: { kind: string }) => (
    <div>outgoing-editor-{kind}</div>
  ),
}));

import OutgoingEmailsSettingsPage from "./page";

describe("/settings/outgoing shell", () => {
  it("renders the three expected tab labels in order", () => {
    render(<OutgoingEmailsSettingsPage />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Invoices",
      "Contracts",
      "Payment links",
    ]);
  });
});
