import { describe, it, expect, vi, afterEach } from "vitest";
import { requestCreateShowcase } from "./showcase-create-request";

// #613 — the Job detail's "Create showcase" action. This client helper POSTs to
// the admin-gated create route and hands back the created draft so the caller
// can open its builder. Pulled out of the component so the request/parse/error
// contract is testable without rendering the 2,000-line Job detail.

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestCreateShowcase", () => {
  it("POSTs to the job's showcases route and returns the created draft", async () => {
    const showcase = { id: "sc-1", job_id: "job-1", title: "" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(201, { showcase }));

    const result = await requestCreateShowcase("job-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job-1/showcases",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(showcase);
  });

  it("throws the server's error message when the create is rejected (e.g. 409)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(409, { error: "This Job already has a Showcase" }),
    );

    await expect(requestCreateShowcase("job-1")).rejects.toThrow(
      "This Job already has a Showcase",
    );
  });

  it("throws a generic error when a failure has no parseable body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    } as Response);

    await expect(requestCreateShowcase("job-1")).rejects.toThrow(/showcase/i);
  });
});
