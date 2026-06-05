import { describe, it, expect } from "vitest";
import { PERMISSION_KEYS } from "./permission-keys";

describe("invoice permission vocabulary (#386)", () => {
  it("retires the create_invoices permission rule — convert is the sole creation path", () => {
    expect(PERMISSION_KEYS).not.toContain("create_invoices");
  });

  it("keeps the surviving invoice permissions (view / edit / manage)", () => {
    expect(PERMISSION_KEYS).toContain("view_invoices");
    expect(PERMISSION_KEYS).toContain("edit_invoices");
    expect(PERMISSION_KEYS).toContain("manage_invoices");
  });

  it("keeps convert_estimates, which now gates the only path an invoice is created", () => {
    expect(PERMISSION_KEYS).toContain("convert_estimates");
  });
});
