import { createClient } from "@/lib/supabase";

export interface UploadJobFilesResult {
  succeeded: { filename: string }[];
  failed: { filename: string; error: string }[];
}

interface SignedUpload {
  filename: string;
  storagePath: string;
  token: string;
  signedUrl: string;
}

// The slice of the Supabase client this module needs — just the signed-URL
// upload. The real browser client (ReturnType<typeof createClient>) satisfies
// it, so the call site is typechecked; a structural stub satisfies it in tests.
type UploadStore = {
  storage: {
    from(bucket: string): {
      uploadToSignedUrl(
        path: string,
        token: string,
        fileBody: File,
      ): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export interface UploadJobFilesDeps {
  fetch: typeof fetch;
  supabase: UploadStore;
}

/**
 * Read an error message out of a failed Response WITHOUT assuming the body is
 * JSON.
 *
 * This is the crux of the bug fix: the upload client used to call
 * `res.json()` unconditionally, so a plain-text platform response — Vercel's
 * 413 `Request Entity Too Large` for an oversized body — threw
 * `Unexpected token 'R', "Request En"... is not valid JSON`, and THAT string
 * became the toast the user saw. Here we special-case the size limit, then
 * read text and only parse it as JSON if it actually is.
 */
async function readError(res: Response): Promise<string> {
  if (res.status === 413) return "File is too large to upload.";
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // Not JSON (an HTML 502 page, a proxy error, etc.) — fall through.
  }
  return text.trim() || `Upload failed (${res.status})`;
}

/**
 * Upload one or more files to a job using the direct-to-storage flow:
 *
 *   1. ask the API for a signed upload URL per file,
 *   2. PUT each file's bytes straight to Supabase Storage (never through our
 *      4.5 MB-capped serverless function), then
 *   3. register the landed objects so they become `job_files` rows.
 *
 * Returns a per-file tally; a failure at any step lands that file in `failed`
 * with a human-readable message rather than throwing.
 */
export async function uploadJobFiles(
  jobId: string,
  files: File[],
  deps?: UploadJobFilesDeps,
): Promise<UploadJobFilesResult> {
  const doFetch = deps?.fetch ?? fetch;
  const supabase = deps?.supabase ?? (createClient() as unknown as UploadStore);

  const succeeded: { filename: string }[] = [];
  const failed: { filename: string; error: string }[] = [];

  // 1. Mint a signed upload URL for each file (small JSON request).
  const urlRes = await doFetch(`/api/jobs/${jobId}/files/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({
        filename: f.name,
        contentType: f.type,
        size: f.size,
      })),
    }),
  });

  if (!urlRes.ok) {
    const error = await readError(urlRes);
    return {
      succeeded,
      failed: files.map((f) => ({ filename: f.name, error })),
    };
  }

  const { uploads } = (await urlRes.json()) as { uploads: SignedUpload[] };

  // 2. PUT each file's bytes straight to storage; gather the ones that landed.
  const registerable: {
    filename: string;
    storagePath: string;
    size: number;
    mimeType: string;
  }[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const up = uploads[i];
    if (!up) {
      failed.push({ filename: f.name, error: "No upload URL was issued" });
      continue;
    }

    const { error } = await supabase.storage
      .from("job-files")
      .uploadToSignedUrl(up.storagePath, up.token, f);

    if (error) {
      failed.push({ filename: f.name, error: error.message });
      continue;
    }

    registerable.push({
      filename: f.name,
      storagePath: up.storagePath,
      size: f.size,
      mimeType: f.type,
    });
  }

  if (registerable.length === 0) {
    return { succeeded, failed };
  }

  // 3. Register the landed objects as job_files rows (small JSON request).
  const regRes = await doFetch(`/api/jobs/${jobId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: registerable }),
  });

  if (!regRes.ok) {
    const error = await readError(regRes);
    for (const r of registerable) failed.push({ filename: r.filename, error });
    return { succeeded, failed };
  }

  const data = (await regRes.json()) as {
    succeeded?: { filename: string }[];
    failed?: { filename: string; error: string }[];
  };
  for (const s of data.succeeded ?? []) succeeded.push({ filename: s.filename });
  for (const f of data.failed ?? []) failed.push(f);

  return { succeeded, failed };
}
