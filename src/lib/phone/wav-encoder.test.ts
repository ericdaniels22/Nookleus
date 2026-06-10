// PRD #304 — Nookleus Phone. Slice 13 (#317) — WAV encoder for the
// record-in-browser voicemail greeting.
//
// The browser's MediaRecorder produces webm/ogg, which Twilio's <Play> cannot
// render (and the greetings-bucket validation rejects). So the record-in-browser
// flow captures raw PCM via the Web Audio API and encodes it to a 16-bit mono
// WAV here — the one format that is both trivially encodable from PCM and
// <Play>-compatible. This module is pure (no Web Audio, no DOM): it turns a
// Float32 sample buffer + sample rate into WAV bytes, so it is fully unit-tested.

import { describe, it, expect } from "vitest";

import { encodeWav, encodeWavBuffer } from "./wav-encoder";

// Read a 4-char ASCII tag from a DataView at an offset.
function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

describe("encodeWavBuffer — canonical 16-bit PCM WAV header", () => {
  it("writes a RIFF/WAVE container with a 16-bit mono PCM fmt chunk at the given sample rate", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWavBuffer(samples, 16000);
    const view = new DataView(buffer);

    // RIFF header.
    expect(tag(view, 0)).toBe("RIFF");
    expect(tag(view, 8)).toBe("WAVE");
    // ChunkSize = 36 + dataSize (dataSize = 5 samples * 2 bytes = 10).
    expect(view.getUint32(4, true)).toBe(36 + 10);

    // fmt subchunk.
    expect(tag(view, 12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // AudioFormat = PCM
    expect(view.getUint16(22, true)).toBe(1); // NumChannels = mono
    expect(view.getUint32(24, true)).toBe(16000); // SampleRate
    expect(view.getUint32(28, true)).toBe(16000 * 2); // ByteRate = rate*block
    expect(view.getUint16(32, true)).toBe(2); // BlockAlign = channels*bytes
    expect(view.getUint16(34, true)).toBe(16); // BitsPerSample

    // data subchunk.
    expect(tag(view, 36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10); // dataSize
  });

  it("scales float samples in [-1,1] to signed 16-bit PCM, clamping out-of-range values", () => {
    const samples = new Float32Array([0, 1, -1, 2, -2]);
    const buffer = encodeWavBuffer(samples, 8000);
    const view = new DataView(buffer);
    const DATA = 44; // PCM data begins right after the 44-byte header.

    expect(view.getInt16(DATA + 0, true)).toBe(0); // silence
    expect(view.getInt16(DATA + 2, true)).toBe(32767); // +1 → max positive
    expect(view.getInt16(DATA + 4, true)).toBe(-32768); // -1 → max negative
    // Out-of-range inputs clamp rather than wrap.
    expect(view.getInt16(DATA + 6, true)).toBe(32767); // +2 clamps to +1
    expect(view.getInt16(DATA + 8, true)).toBe(-32768); // -2 clamps to -1
  });
});

describe("encodeWav — Blob wrapper", () => {
  it("wraps the encoded bytes in an audio/wav Blob the upload route accepts", async () => {
    const blob = encodeWav(new Float32Array([0, 0.25, -0.25]), 16000);
    expect(blob.type).toBe("audio/wav");
    // 44-byte header + 3 samples * 2 bytes.
    expect(blob.size).toBe(44 + 6);
  });
});
