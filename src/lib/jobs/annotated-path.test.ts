import { describe, it, expect } from "vitest";
import { buildAnnotatedPath } from "./annotated-path";

describe("buildAnnotatedPath", () => {
  it("replaces the final extension with a token-suffixed -annotated.png", () => {
    expect(buildAnnotatedPath("job-1/abc.jpg", "k1")).toBe(
      "job-1/abc-annotated-k1.png",
    );
  });

  it("varies the path by token so re-annotation can't be served from CDN cache", () => {
    const a = buildAnnotatedPath("job-1/abc.jpg", "k1");
    const b = buildAnnotatedPath("job-1/abc.jpg", "k2");
    expect(a).not.toBe(b);
  });

  it("strips only the final extension (handles dotted names)", () => {
    expect(buildAnnotatedPath("job-1/a.b.heic", "k1")).toBe(
      "job-1/a.b-annotated-k1.png",
    );
  });
});
