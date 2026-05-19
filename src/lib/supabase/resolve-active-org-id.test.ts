import { describe, it, expect } from "vitest";
import { resolveActiveOrgId } from "./resolve-active-org-id";

function makeToken(payload: object): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("resolveActiveOrgId", () => {
  it("returns the org id from app_metadata.active_organization_id on a valid token", () => {
    const token = makeToken({
      app_metadata: { active_organization_id: "org-123" },
    });

    expect(resolveActiveOrgId(token)).toBe("org-123");
  });

  it("returns null when the token has no active_organization_id claim", () => {
    const token = makeToken({ app_metadata: { other: "value" } });

    expect(resolveActiveOrgId(token)).toBeNull();
  });

  it("returns null when the token has no app_metadata at all", () => {
    const token = makeToken({ sub: "user-1" });

    expect(resolveActiveOrgId(token)).toBeNull();
  });

  it("returns null when the token is not a valid three-part JWT", () => {
    expect(resolveActiveOrgId("not-a-jwt")).toBeNull();
    expect(resolveActiveOrgId("only.two-parts")).toBeNull();
  });

  it("returns null when the payload segment is not valid base64-encoded JSON", () => {
    expect(resolveActiveOrgId("header.@@@not-json@@@.signature")).toBeNull();
  });

  it("returns null for empty, undefined, or null input", () => {
    expect(resolveActiveOrgId("")).toBeNull();
    expect(resolveActiveOrgId(undefined)).toBeNull();
    expect(resolveActiveOrgId(null)).toBeNull();
  });
});
