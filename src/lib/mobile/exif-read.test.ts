import { describe, it, expect } from "vitest";
import { readDimensions, readTakenAt } from "./exif-read";
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

describe("readTakenAt", () => {
  it("reads DateTimeOriginal as a local wall-clock date", async () => {
    const buf = readFileSync(
      resolve(__dirname, "__fixtures__/sample-exif-dates.jpg"),
    );
    const takenAt = await readTakenAt(new Blob([buf], { type: "image/jpeg" }));
    // Fixture: DateTimeOriginal 2024:03:15 14:30:00, CreateDate
    // 2024:03:14 09:15:00 — getting the 15th proves DateTimeOriginal wins.
    expect(takenAt).not.toBeNull();
    expect(takenAt!.getFullYear()).toBe(2024);
    expect(takenAt!.getMonth()).toBe(2);
    expect(takenAt!.getDate()).toBe(15);
    expect(takenAt!.getHours()).toBe(14);
    expect(takenAt!.getMinutes()).toBe(30);
  });

  it("returns null for a JPEG without EXIF dates", async () => {
    const buf = readFileSync(
      resolve(__dirname, "__fixtures__/sample-640x480-orient1.jpg"),
    );
    const takenAt = await readTakenAt(new Blob([buf], { type: "image/jpeg" }));
    expect(takenAt).toBeNull();
  });

  it("returns null on a non-image blob", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], {
      type: "application/octet-stream",
    });
    expect(await readTakenAt(blob)).toBeNull();
  });
});
