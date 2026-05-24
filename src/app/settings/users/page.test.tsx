import { describe, it, expect, vi } from "vitest";

// #228 — /settings/users is gone; the route now redirects into the
// combined /settings/people shell with the Users & Crew tab pre-selected.

const redirectSpy = vi.fn((_: string) => {
  // next/navigation.redirect throws under the hood; mirror that so callers
  // that wrap it in try/catch behave like in production.
  throw new Error("__NEXT_REDIRECT__");
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectSpy(url),
}));

import UsersRedirectPage from "./page";

describe("/settings/users → /settings/people?tab=users", () => {
  it("server-redirects to the People shell with the users tab selected", () => {
    expect(() => UsersRedirectPage()).toThrow("__NEXT_REDIRECT__");
    expect(redirectSpy).toHaveBeenCalledWith("/settings/people?tab=users");
  });
});
