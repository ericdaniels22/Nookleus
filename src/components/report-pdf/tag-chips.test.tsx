import { describe, expect, it } from "vitest";

import TagChips, { chipTextColor } from "./tag-chips";
import { collectText, expandTree, findAll, flattenStyle } from "./test-helpers";

describe("chipTextColor", () => {
  it("picks white text on a dark chip", () => {
    expect(chipTextColor("#000000").toLowerCase()).toBe("#ffffff");
    expect(chipTextColor("#ff0000").toLowerCase()).toBe("#ffffff");
  });

  it("picks dark text on a light chip", () => {
    // A near-white chip must not get white text.
    expect(chipTextColor("#ffffff").toLowerCase()).not.toBe("#ffffff");
    expect(chipTextColor("#ffff00").toLowerCase()).not.toBe("#ffffff");
  });
});

describe("TagChips", () => {
  const tags = [
    { name: "Damage", color: "#ff0000" },
    { name: "Repaired", color: "#00aa00" },
  ];

  it("renders one chip per tag, carrying each tag's name", () => {
    const tree = expandTree(<TagChips tags={tags} />);
    const text = collectText(tree);
    expect(text).toContain("Damage");
    expect(text).toContain("Repaired");
  });

  it("colors each chip with its tag color", () => {
    const tree = expandTree(<TagChips tags={tags} />);
    const backgrounds = findAll(tree, (n) => n.type === "VIEW")
      .map((n) => flattenStyle(n.props.style).backgroundColor)
      .filter(Boolean);
    expect(backgrounds).toContain("#ff0000");
    expect(backgrounds).toContain("#00aa00");
  });

  it("gives each chip a contrasting text color", () => {
    const tree = expandTree(<TagChips tags={[{ name: "Dark", color: "#000000" }]} />);
    const texts = findAll(
      tree,
      (n) => n.type === "TEXT" && collectText(n) === "Dark",
    );
    expect(texts).toHaveLength(1);
    expect(
      String(flattenStyle(texts[0].props.style).color).toLowerCase(),
    ).toBe("#ffffff");
  });

  it("renders nothing when there are no tags", () => {
    const tree = expandTree(<TagChips tags={[]} />);
    expect(findAll(tree, (n) => n.type === "VIEW")).toHaveLength(0);
    expect(findAll(tree, (n) => n.type === "TEXT")).toHaveLength(0);
  });
});
