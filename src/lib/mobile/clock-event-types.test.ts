import { describe, it, expect } from "vitest";
import {
  buildClockEventPayload,
  type ClockEventSidecar,
} from "./clock-event-types";

// #702 — offline-resilient clock-in/out. A ClockEventSidecar is the on-disk
// record of one tap that hasn't reached the server yet (mirrors the photo
// CaptureSidecar). `buildClockEventPayload` is the pure mapping from that
// sidecar to the JSON body the Route Handler expects — device `taken_at`
// becomes the recorded session time (AC4), and the body carries NO location
// field of any kind (ADR 0019 / AC7).

function baseSidecar(over: Partial<ClockEventSidecar> = {}): ClockEventSidecar {
  return {
    client_capture_id: "11111111-1111-1111-1111-111111111111",
    kind: "clock-in",
    job_id: "22222222-2222-2222-2222-222222222222",
    // Design A: a clock-in sidecar carries the device-generated session id (the
    // device commits to it at tap time); a clock-out carries the id of the
    // session it closes.
    session_id: "44444444-4444-4444-4444-444444444444",
    taken_at: "2026-06-19T13:00:00.000Z",
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
    ...over,
  };
}

describe("buildClockEventPayload", () => {
  it("maps a clock-in sidecar to { jobId, sessionId, clientCaptureId, takenAt } — the device session id flows so a queued clock-out can name it before the clock-in ever syncs (Design A)", () => {
    // The clock-in payload must transmit the device session id so the Route
    // Handler inserts the row with id = that id; a queued clock-out then
    // references the same id, and strict-FIFO drain lands the clock-in row first.
    const payload = buildClockEventPayload(baseSidecar());
    expect(payload).toEqual({
      jobId: "22222222-2222-2222-2222-222222222222",
      sessionId: "44444444-4444-4444-4444-444444444444",
      clientCaptureId: "11111111-1111-1111-1111-111111111111",
      takenAt: "2026-06-19T13:00:00.000Z",
    });
  });

  it("maps a clock-out sidecar to { sessionId, clientCaptureId, takenAt } — the original session", () => {
    const payload = buildClockEventPayload(
      baseSidecar({
        kind: "clock-out",
        session_id: "33333333-3333-3333-3333-333333333333",
        taken_at: "2026-06-19T17:30:00.000Z",
      }),
    );
    expect(payload).toEqual({
      sessionId: "33333333-3333-3333-3333-333333333333",
      clientCaptureId: "11111111-1111-1111-1111-111111111111",
      takenAt: "2026-06-19T17:30:00.000Z",
    });
  });

  it("never carries a location field on the sidecar or the wire payload (ADR 0019 / AC7)", () => {
    const forbidden = /(latitude|longitude|\blat\b|\blng\b|geo|fence|region|coord|gps|location)/i;
    const allKeys = (obj: unknown): string[] => {
      const keys: string[] = [];
      const walk = (o: unknown) => {
        if (o && typeof o === "object") {
          for (const k of Object.keys(o)) {
            keys.push(k);
            walk((o as Record<string, unknown>)[k]);
          }
        }
      };
      walk(obj);
      return keys;
    };
    const clockIn = baseSidecar({ kind: "clock-in" });
    const clockOut = baseSidecar({
      kind: "clock-out",
      session_id: "33333333-3333-3333-3333-333333333333",
    });
    const surfaces = [
      clockIn,
      clockOut,
      buildClockEventPayload(clockIn),
      buildClockEventPayload(clockOut),
    ];
    for (const surface of surfaces) {
      expect(allKeys(surface).filter((k) => forbidden.test(k))).toEqual([]);
    }
  });
});
