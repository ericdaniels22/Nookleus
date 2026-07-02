import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LightContentIsland } from "./light-content-island";

// §2.8 — the reading pane and the compose surface are deliberate LIGHT zones
// inside the otherwise dark app: received HTML mail is authored for white
// backgrounds, and what you compose must match what recipients see. The app
// sets `color-scheme: dark` globally (globals.css), which would render native
// controls (inputs, checkboxes, date pickers, scrollbars) dark *inside* these
// light zones — a subtle bleed the class-level `bg-white` can't fix.
// LightContentIsland is the shared wrapper that scopes `color-scheme: light`
// so the island is its own light context regardless of the ambient theme.
// No jest-dom matchers (none configured) — assertions read the DOM directly.
describe("LightContentIsland", () => {
  it("renders its children", () => {
    render(
      <LightContentIsland>
        <span>received mail</span>
      </LightContentIsland>,
    );
    expect(screen.getByText("received mail").textContent).toBe("received mail");
  });

  it("scopes color-scheme:light so native UI stays light inside the dark app", () => {
    const { container } = render(
      <LightContentIsland>
        <span>x</span>
      </LightContentIsland>,
    );
    const island = container.firstElementChild as HTMLElement;
    expect(island.style.colorScheme).toBe("light");
  });

  it("keeps color-scheme:light even when a caller passes their own style", () => {
    // The island's light context is a non-negotiable contract, not a default —
    // a caller extending `style` (e.g. for width) must not be able to flip it
    // back to the dark scheme.
    const { container } = render(
      <LightContentIsland style={{ colorScheme: "dark", width: 320 }}>
        <span>x</span>
      </LightContentIsland>,
    );
    const island = container.firstElementChild as HTMLElement;
    expect(island.style.colorScheme).toBe("light");
    expect(island.style.width).toBe("320px");
  });

  it("forwards className so callers can shape the surface", () => {
    const { container } = render(
      <LightContentIsland className="rounded-lg">
        <span>x</span>
      </LightContentIsland>,
    );
    const island = container.firstElementChild as HTMLElement;
    expect(island.className.includes("rounded-lg")).toBe(true);
  });
});
