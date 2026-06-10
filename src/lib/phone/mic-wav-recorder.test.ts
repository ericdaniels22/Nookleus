// PRD #304 — Nookleus Phone. Slice 13 (#317) — mic → WAV recorder.
//
// The recorder itself is thin Web Audio glue (getUserMedia → AudioContext →
// ScriptProcessor), exercised end-to-end only in the browser. Its one piece of
// non-glue logic — stitching the per-callback PCM chunks back into one
// contiguous sample buffer — is extracted here and unit-tested; the WAV byte
// layout is covered by wav-encoder.test.ts.

import { describe, it, expect } from "vitest";

import { mergeChannelChunks } from "./mic-wav-recorder";

describe("mergeChannelChunks", () => {
  it("concatenates the captured chunks in order into one Float32Array", () => {
    const merged = mergeChannelChunks([
      new Float32Array([0, 0.1]),
      new Float32Array([0.2, 0.3, 0.4]),
      new Float32Array([0.5]),
    ]);
    expect(merged.length).toBe(6);
    expect(Array.from(merged)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5].map((n) =>
      // Float32 rounds, so compare via the same precision the buffer stores.
      new Float32Array([n])[0],
    ));
  });

  it("returns an empty buffer when nothing was captured", () => {
    expect(mergeChannelChunks([]).length).toBe(0);
  });
});
