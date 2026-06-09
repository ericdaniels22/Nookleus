import { describe, expect, it } from "vitest";

import { pinTemplatesByDamageType } from "./pin-templates-by-damage-type";

// Minimal template shape — only the field the helper reads matters.
function t(id: string, tags: string[]) {
  return { id, damage_type_tags: tags };
}

describe("pinTemplatesByDamageType (lifted from the removed template banner)", () => {
  it("floats templates whose damage_type_tags include the job's damage type to the top", () => {
    const templates = [
      t("a", ["fire"]),
      t("b", ["water"]),
      t("c", []),
      t("d", ["water", "mold"]),
    ];

    const ordered = pinTemplatesByDamageType(templates, "water");

    expect(ordered.map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("preserves the original relative order within the pinned and unpinned groups", () => {
    const templates = [
      t("a", ["water"]),
      t("b", ["fire"]),
      t("c", ["water"]),
      t("d", ["fire"]),
    ];

    const ordered = pinTemplatesByDamageType(templates, "water");

    // a,c pinned (in order); b,d follow (in order)
    expect(ordered.map((x) => x.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns the list unchanged when the job has no damage type", () => {
    const templates = [t("a", ["fire"]), t("b", ["water"]), t("c", [])];

    const ordered = pinTemplatesByDamageType(templates, null);

    expect(ordered.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
