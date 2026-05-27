// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Issue #309 is blocked by #305 (A2P 10DLC registration must clear before
// US carriers will deliver outbound business SMS). The PRD says:
//
//   "engineering can ship behind a feature flag earlier; flip the flag
//    the day the campaign clears"
//
// This helper reads the env var. Default OFF: shipping the code with the
// flag set defaults to OFF means the route and UI behave as if the
// outbound surface isn't there. The day A2P clears, set
// `NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED=true` in Vercel and ship.

import { describe, it, expect, vi } from "vitest";
import { isPhoneOutboundEnabled } from "./feature-flags";

describe("isPhoneOutboundEnabled", () => {
  it("returns false when the env var is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    try {
      expect(isPhoneOutboundEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns true only for the exact string 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
    try {
      expect(isPhoneOutboundEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns false for truthy-ish strings that aren't 'true'", () => {
    for (const v of ["1", "yes", "TRUE", " true ", "on"]) {
      vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", v);
      try {
        expect(isPhoneOutboundEnabled()).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });
});
