// PRD #304 — Nookleus Phone. Slice 8 (#312) — inbound-rule validation.
//
// `parseInboundRule` is the trust boundary between the Settings → Phone
// editor's PATCH body (untrusted JSON) and the `phone_numbers.inbound_rule`
// jsonb column. It accepts only the four well-formed shapes the router
// understands (ring-all / round-robin / forward / voicemail) and rejects
// everything else with a human-readable error. Pure: no I/O.
//
// The shapes mirror the `InboundRule` discriminated union the router
// (decideShared) consumes, so a saved rule is always routable.

import { describe, it, expect } from "vitest";
import { parseInboundRule } from "./parse-inbound-rule";

describe("parseInboundRule — ring-all", () => {
  it("accepts a ring-all rule with a users array", () => {
    const result = parseInboundRule({ kind: "ring-all", users: ["u1", "u2"] });
    expect(result).toEqual({
      ok: true,
      rule: { kind: "ring-all", users: ["u1", "u2"] },
    });
  });
});

describe("parseInboundRule — round-robin", () => {
  it("accepts a round-robin rule with a sequence array", () => {
    const result = parseInboundRule({
      kind: "round-robin",
      sequence: ["u1", "u2", "u3"],
    });
    expect(result).toEqual({
      ok: true,
      rule: { kind: "round-robin", sequence: ["u1", "u2", "u3"] },
    });
  });
});

describe("parseInboundRule — forward", () => {
  it("accepts a forward rule with a forwardUserId string", () => {
    const result = parseInboundRule({ kind: "forward", forwardUserId: "u2" });
    expect(result).toEqual({
      ok: true,
      rule: { kind: "forward", forwardUserId: "u2" },
    });
  });
});

describe("parseInboundRule — voicemail", () => {
  it("accepts a bare voicemail rule (no extra fields required)", () => {
    const result = parseInboundRule({ kind: "voicemail" });
    expect(result).toEqual({
      ok: true,
      rule: { kind: "voicemail" },
    });
  });
});

describe("parseInboundRule — rejects malformed input", () => {
  it("rejects a non-object (null)", () => {
    expect(parseInboundRule(null)).toMatchObject({ ok: false });
  });

  it("rejects a non-object (string)", () => {
    expect(parseInboundRule("ring-all")).toMatchObject({ ok: false });
  });

  it("rejects an unknown kind", () => {
    const result = parseInboundRule({ kind: "page-everyone" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("page-everyone");
  });

  it("rejects ring-all when users is not a string array", () => {
    expect(parseInboundRule({ kind: "ring-all", users: "u1" })).toMatchObject({
      ok: false,
    });
    expect(parseInboundRule({ kind: "ring-all" })).toMatchObject({ ok: false });
    expect(
      parseInboundRule({ kind: "ring-all", users: [1, 2] }),
    ).toMatchObject({ ok: false });
  });

  it("rejects round-robin when sequence is not a string array", () => {
    expect(
      parseInboundRule({ kind: "round-robin", sequence: "u1" }),
    ).toMatchObject({ ok: false });
    expect(parseInboundRule({ kind: "round-robin" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects forward when forwardUserId is missing or not a string", () => {
    expect(parseInboundRule({ kind: "forward" })).toMatchObject({ ok: false });
    expect(
      parseInboundRule({ kind: "forward", forwardUserId: 42 }),
    ).toMatchObject({ ok: false });
  });

  it("does not let extra fields leak into the parsed rule", () => {
    const result = parseInboundRule({
      kind: "ring-all",
      users: ["u1"],
      malicious: "DROP TABLE",
    });
    expect(result).toEqual({
      ok: true,
      rule: { kind: "ring-all", users: ["u1"] },
    });
  });
});
