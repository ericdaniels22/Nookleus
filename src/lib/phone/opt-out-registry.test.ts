// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Tests for the TCPA STOP/HELP keyword classifier. Pure: no I/O, no
// Supabase, no HTTP. The persistence of the per-org opt-out registry
// (the `phone_opt_outs` table) is a thin shell on top.
//
// Carrier-required keyword matching is by message body alone, normalized:
// trimmed of leading/trailing whitespace and case-insensitive. The match
// is whole-body, not a substring — "stop spamming me" is NOT a STOP
// because the customer would lose the ability to talk freely without
// triggering unintended opt-outs. (The CTIA Short Code Monitoring Handbook
// specifies whole-word matching; HELP/INFO follow the same rule.)
//
// Mandatory keywords per CTIA / TCPA:
//   STOP-side:  STOP, UNSUBSCRIBE, END, QUIT, CANCEL, STOPALL
//   HELP-side:  HELP, INFO
//
// Everything else (empty body, multi-word message, similar-but-not-equal
// words like "stopper") classifies as `null` — neither a STOP nor a HELP.

import { describe, it, expect } from "vitest";
import { classifyOptOutKeyword } from "./opt-out-registry";

describe("classifyOptOutKeyword — STOP keywords", () => {
  const stopWords = ["STOP", "UNSUBSCRIBE", "END", "QUIT", "CANCEL", "STOPALL"];
  for (const word of stopWords) {
    it(`classifies "${word}" as 'stop'`, () => {
      expect(classifyOptOutKeyword(word)).toBe("stop");
    });
    it(`classifies lowercase "${word.toLowerCase()}" as 'stop' (case-insensitive)`, () => {
      expect(classifyOptOutKeyword(word.toLowerCase())).toBe("stop");
    });
    it(`classifies mixed-case "${word[0] + word.slice(1).toLowerCase()}" as 'stop'`, () => {
      expect(
        classifyOptOutKeyword(word[0] + word.slice(1).toLowerCase()),
      ).toBe("stop");
    });
    it(`classifies "${word}" with surrounding whitespace as 'stop'`, () => {
      expect(classifyOptOutKeyword(`  ${word}\n`)).toBe("stop");
    });
  }
});

describe("classifyOptOutKeyword — HELP keywords", () => {
  const helpWords = ["HELP", "INFO"];
  for (const word of helpWords) {
    it(`classifies "${word}" as 'help'`, () => {
      expect(classifyOptOutKeyword(word)).toBe("help");
    });
    it(`classifies lowercase "${word.toLowerCase()}" as 'help' (case-insensitive)`, () => {
      expect(classifyOptOutKeyword(word.toLowerCase())).toBe("help");
    });
    it(`classifies "${word}" with surrounding whitespace as 'help'`, () => {
      expect(classifyOptOutKeyword(`\t${word} `)).toBe("help");
    });
  }
});

describe("classifyOptOutKeyword — non-matches", () => {
  it("returns null for empty string", () => {
    expect(classifyOptOutKeyword("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(classifyOptOutKeyword("   \n  ")).toBeNull();
  });

  it("returns null when STOP is part of a longer word (substring guard)", () => {
    // CTIA requires whole-body matching — a customer venting "stop calling
    // me right now you nutcase" should not be silently opted out without
    // a clear single-word command. The whole-body rule eliminates
    // ambiguity.
    expect(classifyOptOutKeyword("stop calling me right now")).toBeNull();
    expect(classifyOptOutKeyword("stopper")).toBeNull();
    expect(classifyOptOutKeyword("please STOP")).toBeNull();
  });

  it("returns null when HELP appears alongside other text", () => {
    expect(classifyOptOutKeyword("i need help with my insurance")).toBeNull();
    expect(classifyOptOutKeyword("HELP ME")).toBeNull();
  });

  it("returns null for ordinary customer messages", () => {
    expect(classifyOptOutKeyword("Hi, can you come Tuesday?")).toBeNull();
    expect(classifyOptOutKeyword("yes")).toBeNull();
    expect(classifyOptOutKeyword("123 Main St")).toBeNull();
  });

  it("returns null for whitespace-only bodies regardless of unicode space", () => {
    expect(classifyOptOutKeyword("  ")).toBeNull();
  });
});
