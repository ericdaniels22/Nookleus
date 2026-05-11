import { describe, it, expect } from "vitest";
import { readDimensions } from "./exif-read";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("exif-read", () => {
  it("reads width/height/orientation from a known JPEG", async () => {
    const buf = readFileSync(
      resolve(__dirname, "__fixtures__/sample-640x480-orient1.jpg"),
    );
    const blob = new Blob([buf], { type: "image/jpeg" });
    const dims = await readDimensions(blob);
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(480);
    expect(dims.orientation).toBe(1);
  });

  it("falls back to 0/0/1 on a non-JPEG blob", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], {
      type: "application/octet-stream",
    });
    const dims = await readDimensions(blob);
    expect(dims).toEqual({ width: 0, height: 0, orientation: 1 });
  });
});
