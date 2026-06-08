import { describe, it, expect } from "vitest";

import { isPhoneViewport, PHONE_MAX_WIDTH } from "./photo-viewer-layout";

describe("isPhoneViewport", () => {
  it("treats viewports narrower than the breakpoint as phone", () => {
    expect(isPhoneViewport(390)).toBe(true); // iPhone-class portrait
    expect(isPhoneViewport(PHONE_MAX_WIDTH - 1)).toBe(true);
  });

  it("treats the breakpoint and wider as desktop", () => {
    expect(isPhoneViewport(PHONE_MAX_WIDTH)).toBe(false);
    expect(isPhoneViewport(1024)).toBe(false); // jsdom's default / tablet+
  });

  it("treats an unmeasured (0 or negative) width as desktop", () => {
    // Server render / before the viewport is measured — default to the richer
    // layout rather than flashing the phone one.
    expect(isPhoneViewport(0)).toBe(false);
    expect(isPhoneViewport(-1)).toBe(false);
  });
});
