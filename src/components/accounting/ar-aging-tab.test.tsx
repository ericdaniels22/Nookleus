import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import ArAgingTab from "./ar-aging-tab";

const DATA = {
  buckets: {
    current: { total: 1000, count: 2 },
    "1-30": { total: 500, count: 1 },
    "31-60": { total: 300, count: 1 },
    "61-90": { total: 200, count: 1 },
    "90+": { total: 700, count: 1 },
  },
  rows: [
    {
      invoiceId: "i1",
      jobId: "j1",
      jobNumber: "24-1",
      jobAddress: "1 Main St",
      invoiceNumber: "INV-1",
      payerType: "insurance",
      outstanding: 777,
      ageDays: 95,
      bucket: "90+",
      lastContact: null,
    },
  ],
};

function mockData(d: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => d })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<ArAgingTab> §3 tabular numerals", () => {
  it("renders the Outstanding money cell with tabular-nums", async () => {
    mockData(DATA);
    const { findByText } = render(<ArAgingTab />);

    const cell = await findByText("$777");
    expect(cell.className).toContain("tabular-nums");
  });
});

describe("<ArAgingTab> §2 token colors", () => {
  it("uses no inline hex or rgba colors anywhere", async () => {
    mockData(DATA);
    const { findByText } = render(<ArAgingTab />);
    await findByText("$777");

    for (const el of document.querySelectorAll<HTMLElement>("[style]")) {
      const style = el.getAttribute("style") ?? "";
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(style).not.toMatch(/rgba?\(/);
    }
  });

  it("keeps the aging gradient distinct: 90+ is danger, current is neutral", async () => {
    mockData(DATA);
    const { findByText } = render(<ArAgingTab />);

    const severe = await findByText("90+d");
    const neutral = await findByText("Current");
    // A palette class carries the severity — red family for 90+, muted for current.
    expect(severe.className).toContain("red");
    expect(neutral.className).toContain("muted-foreground");
  });
});
