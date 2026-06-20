// src/lib/mobile/clock-event-poster.ts — the fetch adapter the clock-event
// queue worker (clock-event-queue.ts) posts each drained tap through (#702).
//
// It turns a Route Handler response into the worker's PostResult. Any 2xx is
// success — including an idempotent replay the server no-ops, since the worker
// is agnostic to whether a tap is new or a retry. A non-2xx, or a thrown fetch
// (offline / DNS), is a retriable failure that keeps the tap queued.

import type { PostClockEvent, PostResult } from "./clock-event-queue";
import type { ClockEventKind } from "./clock-event-types";

const ROUTES: Record<ClockEventKind, string> = {
  "clock-in": "/api/time/clock-in",
  "clock-out": "/api/time/clock-out",
};

// `fetchImpl` is injected so the adapter is testable without stubbing the
// global; production wiring calls it with no argument and uses global fetch.
export function createClockEventPoster(
  fetchImpl: typeof fetch = fetch,
): PostClockEvent {
  return async (kind, payload) => {
    let res: Response;
    try {
      res = await fetchImpl(ROUTES[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // A thrown fetch is a transport failure, not a server verdict — retriable.
      // status 0 marks "the tap never reached the server".
      return { ok: false, status: 0, error: String((err as Error)?.message ?? err) };
    }

    const result: PostResult = { ok: res.ok, status: res.status };
    const body = (await res.json().catch(() => null)) as
      | { sessionId?: unknown; error?: unknown }
      | null;
    if (body && typeof body === "object") {
      // The route returns the authoritative session id — the original on a
      // replay — which the wiring layer uses to pin a queued clock-out's target.
      if (typeof body.sessionId === "string") result.sessionId = body.sessionId;
      if (!res.ok && typeof body.error === "string") result.error = body.error;
    }
    return result;
  };
}
