import { describe, it, expect } from "vitest";
import { isSendShortcut } from "./send-shortcut";

describe("isSendShortcut", () => {
  it("fires on Cmd+Enter (macOS)", () => {
    expect(isSendShortcut({ key: "Enter", metaKey: true, ctrlKey: false })).toBe(
      true,
    );
  });

  it("fires on Ctrl+Enter (Windows/Linux)", () => {
    expect(isSendShortcut({ key: "Enter", metaKey: false, ctrlKey: true })).toBe(
      true,
    );
  });

  it("ignores a plain Enter so newlines are not hijacked", () => {
    expect(
      isSendShortcut({ key: "Enter", metaKey: false, ctrlKey: false }),
    ).toBe(false);
  });

  it("ignores a modifier held with a non-Enter key", () => {
    expect(isSendShortcut({ key: "a", metaKey: true, ctrlKey: false })).toBe(
      false,
    );
  });
});
