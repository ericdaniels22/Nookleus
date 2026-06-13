// PRD #304 — Nookleus Phone. Slice 13 (#317) — record a voicemail greeting
// from the microphone and encode it to WAV.
//
// MediaRecorder would be simpler but only yields webm/ogg, which Twilio's
// <Play> cannot render. So we tap the raw mono PCM via the Web Audio API,
// accumulate it across processor callbacks, and on stop stitch the chunks
// together and hand them to the pure WAV encoder. The byte layout lives in
// wav-encoder.ts; the chunk-stitching is `mergeChannelChunks` (unit-tested);
// everything else here is browser-only Web Audio glue.

import { encodeWav } from "./wav-encoder";

// Stitch the per-callback PCM chunks (each a copy of one channel's samples)
// into one contiguous buffer, preserving capture order.
export function mergeChannelChunks(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

export interface MicWavRecording {
  // Stop capturing, release the mic, and resolve the recorded audio as a WAV
  // Blob (audio/wav) ready to upload.
  stop(): Promise<Blob>;
  // Stop capturing and release the mic without producing a Blob.
  cancel(): void;
}

// The ScriptProcessor buffer size — a power of two between 256 and 16384. 4096
// is the common default: large enough to keep callback overhead low, small
// enough that stop() flushes promptly.
const PROCESSOR_BUFFER_SIZE = 4096;

/**
 * Begin recording from the default microphone. Resolves once the mic is live;
 * call `stop()` to finish and get the WAV Blob, or `cancel()` to discard. The
 * caller is responsible for any max-duration UX — this records until stopped.
 *
 * Browser-only: relies on getUserMedia + AudioContext. Not unit-tested (the
 * component test injects a fake recording); the pure pieces it leans on
 * (`mergeChannelChunks`, `encodeWav`) are tested directly.
 */
export async function startMicWavRecording(): Promise<MicWavRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtor();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    // Copy — the event's buffer is reused across callbacks.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  function teardown(): void {
    processor.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  }

  return {
    async stop(): Promise<Blob> {
      const sampleRate = ctx.sampleRate;
      teardown();
      return encodeWav(mergeChannelChunks(chunks), sampleRate);
    },
    cancel(): void {
      teardown();
    },
  };
}
