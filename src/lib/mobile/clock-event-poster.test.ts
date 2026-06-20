import { describe, it, expect, vi } from "vitest";
import { createClockEventPoster } from "./clock-event-poster";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// #702 — the fetch adapter the queue worker posts each drained tap through. It
// maps a Route Handler response into the worker's PostResult: any 2xx (including
// an idempotent replay the server no-ops) is success; a non-2xx or a thrown
// fetch is a retriable failure.
describe("createClockEventPoster", () => {
  it("posts a clock-in to its route as JSON and surfaces the resolved session id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(201, { sessionId: "sess-1" }),
    );
    const post = createClockEventPoster(fetchMock as never);

    const result = await post("clock-in", {
      jobId: "job-1",
      sessionId: "sess-1",
      clientCaptureId: "cap-1",
      takenAt: "2026-06-19T08:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/time/clock-in");
    expect(init.method).toBe("POST");
    // The device-generated session id (Design A) travels in the body so the
    // route inserts the row with that id.
    expect(JSON.parse(init.body as string)).toEqual({
      jobId: "job-1",
      sessionId: "sess-1",
      clientCaptureId: "cap-1",
      takenAt: "2026-06-19T08:00:00.000Z",
    });
    expect(result).toEqual({ ok: true, status: 201, sessionId: "sess-1" });
  });

  it("routes a clock-out to the clock-out endpoint with its payload", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { closed: true, sessionId: "sess-1" }),
    );
    const post = createClockEventPoster(fetchMock as never);

    await post("clock-out", {
      sessionId: "sess-1",
      clientCaptureId: "cap-2",
      takenAt: "2026-06-19T17:00:00.000Z",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/time/clock-out");
    expect(JSON.parse(init.body as string)).toEqual({
      sessionId: "sess-1",
      clientCaptureId: "cap-2",
      takenAt: "2026-06-19T17:00:00.000Z",
    });
  });

  it("treats a non-2xx as a retriable failure and surfaces the server error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: "db down" }));
    const post = createClockEventPoster(fetchMock as never);

    const result = await post("clock-in", {
      jobId: "j",
      sessionId: "s",
      clientCaptureId: "c",
      takenAt: "t",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe("db down");
  });

  it("maps a thrown fetch (offline / DNS) to status 0 — it never reached the server", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("Network request failed");
    });
    const post = createClockEventPoster(fetchMock as never);

    const result = await post("clock-in", {
      jobId: "j",
      sessionId: "s",
      clientCaptureId: "c",
      takenAt: "t",
    });

    expect(result).toEqual({
      ok: false,
      status: 0,
      error: "Network request failed",
    });
  });
});
