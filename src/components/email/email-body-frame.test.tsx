import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { EmailBodyFrame } from "./email-body-frame";

// The reading pane's light content island (§2.8): received HTML mail is
// authored for white backgrounds, so we render it in a SANDBOXED IFRAME rather
// than inverting it into the dark theme. The iframe is the isolation boundary —
// no CSS from the dark app can cascade in, and the frame's own document forces
// `color-scheme: light` on a white background. These are regression guards for
// the design-v2 reskin (step 9 / #918): the chrome around the frame changes,
// but the isolation + light context must not.
//
// No jest-dom matchers (none configured) — assertions read the DOM directly.
beforeAll(() => {
  // jsdom has no ResizeObserver; the frame observes its body to auto-size.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("EmailBodyFrame", () => {
  it("renders the received mail inside an isolated iframe", () => {
    const { container } = render(
      <EmailBodyFrame html="<p>Hello <b>world</b></p>" />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("title")).toBe("Email body");
    expect(iframe?.contentDocument?.body?.innerHTML).toContain(
      "<p>Hello <b>world</b></p>",
    );
  });

  it("forces a light color-scheme on a white background so the dark theme cannot bleed in", () => {
    const { container } = render(<EmailBodyFrame html="<p>hi</p>" />);
    const iframe = container.querySelector("iframe");
    const styles = iframe?.contentDocument?.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("color-scheme: light");
    expect(styles).toContain("background: #fff");
  });

  it("keeps allow-popups-to-escape-sandbox so in-app links (e.g. /sign) open unsandboxed", () => {
    // Regression guard: without this flag a `<base target=_blank>` popup
    // inherits the iframe sandbox and the /sign/[token] page hangs at the SSR
    // shell (see memory: email-iframe-sandbox-popups).
    const { container } = render(<EmailBodyFrame html="<a href='/x'>x</a>" />);
    const sandbox = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-popups-to-escape-sandbox");
    expect(sandbox.split(/\s+/)).toContain("allow-popups");
  });

  it("never enables scripts in the sandbox", () => {
    // Untrusted external mail must not run JavaScript.
    const { container } = render(<EmailBodyFrame html="<p>hi</p>" />);
    const sandbox = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).not.toContain("allow-scripts");
  });
});
