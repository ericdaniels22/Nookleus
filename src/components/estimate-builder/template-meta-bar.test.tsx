// #929 — the template's damage-type pills take the §2.6 badge treatment via
// resolveDamageTypeBadge, exactly like the Jobs surfaces (#914): an
// uncustomized canonical type renders the vivid dark-tint class map, and a
// per-Organization override is softened (low-alpha tint + AA-legible text) —
// the pill never applies the raw stored light-mode colors inline, which is
// what it did before this pass.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import TemplateMetaBar from "./template-meta-bar";
import { soften } from "@/lib/badge-colors";
import type { DamageType, TemplateWithContents } from "@/lib/types";

function makeDamageType(over: Partial<DamageType> & { name: string }): DamageType {
  return {
    id: `dt-${over.name}`,
    display_label: over.name[0].toUpperCase() + over.name.slice(1),
    bg_color: "#E6F1FB",
    text_color: "#0C447C",
    icon: null,
    sort_order: 0,
    is_default: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

// water keeps its seed colors (uncustomized default); fire carries a hostile
// per-org override that must be softened, never applied raw.
const water = makeDamageType({
  name: "water",
  bg_color: "#E6F1FB",
  text_color: "#0C447C",
});
const fire = makeDamageType({
  name: "fire",
  bg_color: "#FF00AA",
  text_color: "#123456",
});

function stubDamageTypesFetch(rows: DamageType[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => rows,
      } as Response),
    ),
  );
}

// Minimal template — the meta bar reads id/name/description/damage_type_tags.
function makeTemplate(tags: string[]): TemplateWithContents {
  return {
    id: "tpl-1",
    name: "Water mitigation",
    description: null,
    damage_type_tags: tags,
    sections: [],
  } as unknown as TemplateWithContents;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("TemplateMetaBar damage-type pills (#929)", () => {
  it("renders a selected uncustomized canonical type with the vivid §2.6 class, no inline colors", async () => {
    stubDamageTypesFetch([water, fire]);
    render(<TemplateMetaBar template={makeTemplate(["water"])} onChange={vi.fn()} />);

    const pill = await screen.findByRole("button", { name: "Water" });
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.className).toContain("bg-sky-400/14");
    expect(pill.className).toContain("text-sky-300");
    // The class-map path never sets the stored colors inline.
    expect(pill.style.background).toBe("");
    expect(pill.style.color).toBe("");
  });

  it("softens a selected per-org override instead of applying the raw stored colors", async () => {
    stubDamageTypesFetch([water, fire]);
    render(<TemplateMetaBar template={makeTemplate(["fire"])} onChange={vi.fn()} />);

    const pill = await screen.findByRole("button", { name: "Fire" });
    const softened = soften(fire.bg_color, fire.text_color);
    await waitFor(() => expect(pill.style.background).toBe(softened.background));
    expect(pill.style.color).not.toBe("");
    // The softened text tone is AA-lightened — never the raw stored #123456.
    expect(pill.style.color).not.toBe("rgb(18, 52, 86)");
  });

  it("leaves unselected pills on the neutral token treatment with no inline style", async () => {
    stubDamageTypesFetch([water, fire]);
    render(<TemplateMetaBar template={makeTemplate([])} onChange={vi.fn()} />);

    const pill = await screen.findByRole("button", { name: "Water" });
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.className).toContain("text-muted-foreground");
    expect(pill.style.background).toBe("");
  });
});
