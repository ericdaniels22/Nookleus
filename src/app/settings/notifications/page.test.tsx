import { describe, it, expect, vi } from "vitest";

// #228 — /settings/notifications is gone; the route now redirects into
// the combined /settings/people shell with the Notifications tab
// pre-selected. The notification bell still deep-links here, so the
// redirect has to land on the same content.

const redirectSpy = vi.fn((_: string) => {
  throw new Error("__NEXT_REDIRECT__");
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectSpy(url),
}));

import NotificationsRedirectPage from "./page";

describe("/settings/notifications → /settings/people?tab=notifications", () => {
  it("server-redirects to the People shell with the notifications tab selected", () => {
    expect(() => NotificationsRedirectPage()).toThrow("__NEXT_REDIRECT__");
    expect(redirectSpy).toHaveBeenCalledWith(
      "/settings/people?tab=notifications"
    );
  });
});
