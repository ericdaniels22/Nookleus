import { describe, it, expect } from "vitest";
import { authorizeTemplateMutation } from "./authorize-template-mutation";

describe("authorizeTemplateMutation", () => {
  it("denies an organization-wide mutation when the caller lacks manage_email_templates", () => {
    expect(
      authorizeTemplateMutation("organization", {
        role: "crew_member",
        grantedPermissions: [],
      }),
    ).toBe(false);
  });

  it("allows an organization-wide mutation when the caller holds manage_email_templates", () => {
    expect(
      authorizeTemplateMutation("organization", {
        role: "crew_lead",
        grantedPermissions: ["manage_email_templates"],
      }),
    ).toBe(true);
  });

  it("allows an organization-wide mutation for an admin without the key explicitly granted", () => {
    expect(
      authorizeTemplateMutation("organization", {
        role: "admin",
        grantedPermissions: [],
      }),
    ).toBe(true);
  });

  it("allows a personal mutation regardless of role or granted permissions", () => {
    expect(
      authorizeTemplateMutation("personal", {
        role: "crew_member",
        grantedPermissions: [],
      }),
    ).toBe(true);
  });
});
