// Issue #909 — design v2 step 1: the app is dark-only, so the toaster is
// pinned to sonner's dark theme. The ThemeProvider is gone in this step;
// without the pin, sonner would fall back to "system" and render light
// toasts on light-mode devices.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const { capturedProps } = vi.hoisted(() => ({
  capturedProps: [] as Record<string, unknown>[],
}));
vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return null;
  },
}));

import { Toaster } from "./sonner";

describe("Toaster — pinned dark theme, no theme provider (#909)", () => {
  it('passes theme="dark" to sonner', () => {
    render(<Toaster />);

    expect(capturedProps.length).toBeGreaterThan(0);
    expect(capturedProps[0].theme).toBe("dark");
  });
});
