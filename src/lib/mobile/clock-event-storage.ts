// src/lib/mobile/clock-event-storage.ts — the on-disk ClockEventStore the queue
// worker (clock-event-queue.ts) injects in production (#702). A sibling of the
// photo capture-storage.ts, simplified for clock taps:
//
//   * flat directory — clock events are a single causal queue, not nested per
//     Job/session the way photos are;
//   * one JSON sidecar per tap, named by its client_capture_id (the idempotency
//     key), so writing the same tap twice overwrites rather than duplicates;
//   * no blob / encryption — a tap is plain JSON, it carries no media.
//
// Like capture-storage.ts this is the native-Filesystem boundary, exercised by
// the app rather than unit tests; the worker's orchestration is what the suite
// covers, against an in-memory store double.

import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { ClockEventSidecar } from "./clock-event-types";
import type { ClockEventStore } from "./clock-event-queue";

const ROOT = "pending-clock-events";
const DIRECTORY = Directory.Documents;

function sidecarPath(clientCaptureId: string): string {
  return `${ROOT}/${clientCaptureId}.json`;
}

async function ensureRoot(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: ROOT, directory: DIRECTORY, recursive: true });
  } catch {
    // Directory likely already exists — mkdir's "exists" failure is benign here.
  }
}

export const filesystemClockEventStore: ClockEventStore = {
  async list(): Promise<ClockEventSidecar[]> {
    let names: string[] = [];
    try {
      const r = await Filesystem.readdir({ path: ROOT, directory: DIRECTORY });
      names = r.files.map((f) => (typeof f === "string" ? f : f.name));
    } catch {
      // Root not created yet → nothing queued.
      return [];
    }
    const out: ClockEventSidecar[] = [];
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      try {
        const r = await Filesystem.readFile({
          path: `${ROOT}/${name}`,
          directory: DIRECTORY,
          encoding: Encoding.UTF8,
        });
        const data = typeof r.data === "string" ? r.data : await r.data.text();
        out.push(JSON.parse(data) as ClockEventSidecar);
      } catch {
        // Skip a damaged entry rather than failing the whole scan.
      }
    }
    return out;
  },

  async put(sidecar: ClockEventSidecar): Promise<void> {
    await ensureRoot();
    await Filesystem.writeFile({
      path: sidecarPath(sidecar.client_capture_id),
      data: JSON.stringify(sidecar, null, 2),
      directory: DIRECTORY,
      encoding: Encoding.UTF8,
    });
  },

  async remove(clientCaptureId: string): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path: sidecarPath(clientCaptureId),
        directory: DIRECTORY,
      });
    } catch {
      // Already gone (e.g. a duplicated drain removed it) — benign.
    }
  },
};
