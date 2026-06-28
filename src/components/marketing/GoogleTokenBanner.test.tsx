// #789 — the Marketing-page banner that warns when the per-org Google
// connection's Testing-mode 7-day token is about to lapse. The when-to-show
// decision is unit-tested in src/lib/google/connection.test.ts; this pins the
// thin rendering: silent while healthy, an alert + reconnect link otherwise.
// No jest-dom matchers (none configured) — assertions go through the DOM.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import GoogleTokenBanner from "./GoogleTokenBanner";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-27T00:00:00.000Z");
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

afterEach(cleanup);

describe("GoogleTokenBanner", () => {
  it("renders nothing when there is no connection", () => {
    const { container } = render(
      <GoogleTokenBanner summary={null} nowMs={NOW} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the token is healthy (days of runway left)", () => {
    const { container } = render(
      <GoogleTokenBanner
        summary={{ state: "connected", token_expires_at: inDays(5) }}
        nowMs={NOW}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("warns with a reconnect link when expiring within two days", () => {
    render(
      <GoogleTokenBanner
        summary={{ state: "connected", token_expires_at: inDays(1) }}
        nowMs={NOW}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/expires in 1 day/i);
    const link = screen.getByRole("link", { name: /reconnect google/i });
    expect(link.getAttribute("href")).toBe("/api/google/authorize");
  });

  it("shows an expired warning once the token has lapsed", () => {
    render(
      <GoogleTokenBanner
        summary={{ state: "connected", token_expires_at: inDays(-1) }}
        nowMs={NOW}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/expired/i);
    expect(
      screen.getByRole("link", { name: /reconnect google/i }).getAttribute("href"),
    ).toBe("/api/google/authorize");
  });

  it("prompts a reconnect when the connection is broken", () => {
    render(
      <GoogleTokenBanner
        summary={{ state: "broken", token_expires_at: null }}
        nowMs={NOW}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/reconnect/i);
    expect(
      screen.getByRole("link", { name: /reconnect google/i }).getAttribute("href"),
    ).toBe("/api/google/authorize");
  });
});
