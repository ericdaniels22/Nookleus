// PRD #304 — Nookleus Phone. Slice 13 (#317) — WAV encoder for record-in-browser
// voicemail greetings.
//
// The browser's MediaRecorder emits webm/ogg, which Twilio's <Play> cannot
// render and the greetings-bucket validation rejects (mp3/wav only). The
// record-in-browser flow therefore captures raw PCM via the Web Audio API and
// encodes it to a canonical 16-bit mono WAV here. This module is intentionally
// pure — it takes a Float32 sample buffer + sample rate and returns WAV bytes,
// with no Web Audio / DOM dependency — so the byte layout is unit-tested.

const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const NUM_CHANNELS = 1; // mono — a voicemail greeting needs no more
const PCM_FORMAT = 1; // WAVE_FORMAT_PCM
const BITS_PER_SAMPLE = 16;
const HEADER_BYTES = 44;

// Clamp a float sample to [-1, 1] and scale to signed 16-bit. +1 maps to the
// max positive (32767) and -1 to the max negative (-32768); out-of-range inputs
// clamp rather than wrap, so a hot mic can never produce a garbage waveform.
function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode mono Float32 PCM samples (each in [-1, 1]) to a 16-bit WAV byte
 * buffer at the given sample rate. The layout is the canonical 44-byte
 * RIFF/WAVE/fmt /data header followed by little-endian int16 samples.
 */
export function encodeWavBuffer(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataSize);
  const view = new DataView(buffer);
  const byteRate = sampleRate * NUM_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = NUM_CHANNELS * BYTES_PER_SAMPLE;

  // RIFF chunk descriptor.
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // ChunkSize = 36 + data
  writeAscii(view, 8, "WAVE");

  // fmt subchunk.
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size for PCM
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data subchunk.
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(HEADER_BYTES + i * BYTES_PER_SAMPLE, floatToInt16(samples[i]), true);
  }

  return buffer;
}

/**
 * Encode mono Float32 PCM samples to an `audio/wav` Blob — the shape the
 * voicemail-greeting upload route (and its validation) accept.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWavBuffer(samples, sampleRate)], { type: "audio/wav" });
}
