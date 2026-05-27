// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Click-to-text button used anywhere we render a phone number. The button
// is a Next.js <Link> to /phone?to=<E.164>; the Phone page reads the
// `to` param and opens the New Conversation form with that recipient
// pre-filled. Slice 5's AC bullet:
//
//   "Click-to-text on Contact card and Adjuster card opens the compose
//    flow with the recipient pre-filled"
//
// The component is tiny — its value is centralizing the link contract
// so adding click-to-text to any new surface is a one-line change.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClickToText } from "./click-to-text";

beforeEach(() => {
  // Flag-ON for the existing assertions; the dedicated test below
  // covers the flag-OFF case.
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ClickToText", () => {
  it("renders a link to /phone with the e164 in the `to` query param", () => {
    render(<ClickToText e164="+15551234567" label="Text" />);
    const link = screen.getByRole("link", { name: /text/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/phone?to=%2B15551234567",
    );
  });

  it("renders nothing when e164 is empty or null", () => {
    const { container } = render(<ClickToText e164={null} label="Text" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders the children when provided instead of label", () => {
    render(
      <ClickToText e164="+15551234567">
        <span>Text Alice</span>
      </ClickToText>,
    );
    expect(screen.getByText("Text Alice")).toBeDefined();
  });

  it("renders nothing when the #309 feature flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    const { container } = render(
      <ClickToText e164="+15551234567" label="Text" />,
    );
    expect(container.querySelector("a")).toBeNull();
  });
});
