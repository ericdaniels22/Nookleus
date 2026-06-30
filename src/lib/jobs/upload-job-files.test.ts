import { describe, it, expect, vi } from "vitest";
import { uploadJobFiles } from "./upload-job-files";

// A minimal File stand-in: the orchestration only reads name/type/size and
// hands the body straight to the (mocked) storage client.
function file(name: string, type = "application/pdf", size = 10): File {
  return { name, type, size } as unknown as File;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Storage that accepts every signed-URL upload.
function okStorage() {
  return {
    storage: {
      from() {
        return {
          async uploadToSignedUrl(path: string) {
            return { data: { path, fullPath: path }, error: null };
          },
        };
      },
    },
  };
}

describe("uploadJobFiles (direct-to-storage signed-URL upload, build30)", () => {
  it("requests a signed URL, uploads to storage, then registers each file", async () => {
    const bodies: Record<string, unknown> = {};
    const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
      bodies[url.endsWith("/upload-url") ? "url" : "register"] = JSON.parse(
        init!.body as string,
      );
      if (url.endsWith("/upload-url")) {
        return jsonResponse({
          uploads: [
            {
              filename: "a.pdf",
              storagePath: "org-1/job-1/u1-a.pdf",
              token: "t1",
              signedUrl: "s1",
            },
          ],
        });
      }
      return jsonResponse({ succeeded: [{ filename: "a.pdf" }], failed: [] });
    });

    const result = await uploadJobFiles("job-1", [file("a.pdf")], {
      fetch: doFetch as unknown as typeof fetch,
      supabase: okStorage() as never,
    });

    expect(result.succeeded.map((s) => s.filename)).toEqual(["a.pdf"]);
    expect(result.failed).toEqual([]);
    // The registration carries the storage path the signed URL was minted for.
    expect(bodies.register).toMatchObject({
      files: [{ filename: "a.pdf", storagePath: "org-1/job-1/u1-a.pdf" }],
    });
  });

  it("reports a per-file error when a direct storage upload fails, and still registers the rest", async () => {
    const doFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/upload-url")) {
        return jsonResponse({
          uploads: [
            {
              filename: "good.pdf",
              storagePath: "org-1/job-1/u1-good.pdf",
              token: "t1",
              signedUrl: "s1",
            },
            {
              filename: "bad.pdf",
              storagePath: "org-1/job-1/u2-bad.pdf",
              token: "t2",
              signedUrl: "s2",
            },
          ],
        });
      }
      return jsonResponse({ succeeded: [{ filename: "good.pdf" }], failed: [] });
    });

    const supabase = {
      storage: {
        from() {
          return {
            async uploadToSignedUrl(path: string) {
              if (path.includes("bad")) {
                return { data: null, error: { message: "storage exploded" } };
              }
              return { data: { path }, error: null };
            },
          };
        },
      },
    };

    const result = await uploadJobFiles(
      "job-1",
      [file("good.pdf"), file("bad.pdf")],
      {
        fetch: doFetch as unknown as typeof fetch,
        supabase: supabase as never,
      },
    );

    expect(result.succeeded.map((s) => s.filename)).toEqual(["good.pdf"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].filename).toBe("bad.pdf");
    expect(result.failed[0].error).toContain("storage exploded");
  });

  it("surfaces a clean message (no JSON-parse crash) when an endpoint returns a non-JSON error body", async () => {
    // Regression for the original bug: the client called res.json()
    // unconditionally and threw `Unexpected token 'R', "Request En"... is not
    // valid JSON` on Vercel's plain-text 413 body. A non-JSON error must now
    // become a clean, human message instead.
    const doFetch = vi.fn(
      async () => new Response("Request Entity Too Large", { status: 413 }),
    );

    const result = await uploadJobFiles("job-1", [file("huge.pdf")], {
      fetch: doFetch as unknown as typeof fetch,
      supabase: okStorage() as never,
    });

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { filename: "huge.pdf", error: "File is too large to upload." },
    ]);
  });
});
