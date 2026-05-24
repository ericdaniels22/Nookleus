import { describe, it, expect, vi, beforeEach } from "vitest";

// #230 — the four pre-redesign URLs keep working by redirecting into the
// combined /settings/money page with the matching ?tab=<key>. The two
// renames (Accounting → quickbooks, Stripe Payments → stripe) are part
// of the redesign and reflected in the redirect targets.

const redirect = vi.fn((_url: string) => {
  throw new Error("__redirect__");
});

vi.mock("next/navigation", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, redirect };
});

beforeEach(() => {
  redirect.mockClear();
});

async function runPage(modulePath: string): Promise<string> {
  const mod = await import(modulePath);
  try {
    await mod.default();
  } catch (e) {
    if ((e as Error).message !== "__redirect__") throw e;
  }
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0] as string;
}

describe("/settings money redirects", () => {
  it("/settings/vendors → /settings/money?tab=vendors", async () => {
    const dest = await runPage("../vendors/page");
    expect(dest).toBe("/settings/money?tab=vendors");
  });

  it("/settings/expense-categories → /settings/money?tab=expense-categories", async () => {
    const dest = await runPage("../expense-categories/page");
    expect(dest).toBe("/settings/money?tab=expense-categories");
  });

  it("/settings/accounting → /settings/money?tab=quickbooks", async () => {
    const dest = await runPage("../accounting/page");
    expect(dest).toBe("/settings/money?tab=quickbooks");
  });

  it("/settings/stripe → /settings/money?tab=stripe", async () => {
    const dest = await runPage("../stripe/page");
    expect(dest).toBe("/settings/money?tab=stripe");
  });
});
