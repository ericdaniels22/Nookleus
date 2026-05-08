import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { CaptureSidecar, PendingCapture } from "./capture-types";

const ROOT = "pending-uploads";
const DIRECTORY = Directory.Documents;

export function getSessionDir(jobId: string, sessionId: string) {
  return `${ROOT}/${jobId}/${sessionId}`;
}

export function getPhotoPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.jpg`;
}

export function getSidecarPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.json`;
}

async function ensureSessionDir(jobId: string, sessionId: string) {
  try {
    await Filesystem.mkdir({
      path: getSessionDir(jobId, sessionId),
      directory: DIRECTORY,
      recursive: true,
    });
  } catch {
    // Directory likely already exists. mkdir's "Directory exists" failure is benign here.
  }
}

export async function writeCapture(args: {
  base64Data: string;
  sidecar: CaptureSidecar;
}): Promise<void> {
  const { base64Data, sidecar } = args;
  const { job_id, capture_session_id, client_capture_id } = sidecar;
  await ensureSessionDir(job_id, capture_session_id);
  await Filesystem.writeFile({
    path: getPhotoPath(job_id, capture_session_id, client_capture_id),
    data: base64Data,
    directory: DIRECTORY,
  });
  await Filesystem.writeFile({
    path: getSidecarPath(job_id, capture_session_id, client_capture_id),
    data: JSON.stringify(sidecar, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
}

export async function readSidecar(
  jobId: string,
  sessionId: string,
  captureId: string,
): Promise<CaptureSidecar> {
  const result = await Filesystem.readFile({
    path: getSidecarPath(jobId, sessionId, captureId),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
  const data = typeof result.data === "string" ? result.data : await result.data.text();
  return JSON.parse(data) as CaptureSidecar;
}

export async function readPhotoDataUrl(
  jobId: string,
  sessionId: string,
  captureId: string,
): Promise<string> {
  const result = await Filesystem.readFile({
    path: getPhotoPath(jobId, sessionId, captureId),
    directory: DIRECTORY,
  });
  const base64 =
    typeof result.data === "string"
      ? result.data
      : await blobToBase64(result.data);
  return `data:image/jpeg;base64,${base64}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function listSessionCaptures(
  jobId: string,
  sessionId: string,
): Promise<PendingCapture[]> {
  let names: string[] = [];
  try {
    const result = await Filesystem.readdir({
      path: getSessionDir(jobId, sessionId),
      directory: DIRECTORY,
    });
    names = result.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return [];
  }
  const sidecarNames = names.filter((n) => n.endsWith(".json"));
  const captures: PendingCapture[] = [];
  for (const name of sidecarNames) {
    const captureId = name.replace(/\.json$/, "");
    try {
      const sidecar = await readSidecar(jobId, sessionId, captureId);
      const thumbnail_data_url = await readPhotoDataUrl(jobId, sessionId, captureId);
      captures.push({ sidecar, thumbnail_data_url });
    } catch {
      // Skip damaged entries; will surface in dev console hook.
    }
  }
  captures.sort((a, b) => a.sidecar.taken_at.localeCompare(b.sidecar.taken_at));
  return captures;
}

export async function updateSidecar(
  jobId: string,
  sessionId: string,
  captureId: string,
  patch: Partial<Pick<CaptureSidecar, "caption" | "tag_ids">>,
): Promise<CaptureSidecar> {
  const current = await readSidecar(jobId, sessionId, captureId);
  const next: CaptureSidecar = { ...current, ...patch };
  await Filesystem.writeFile({
    path: getSidecarPath(jobId, sessionId, captureId),
    data: JSON.stringify(next, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
  return next;
}

export async function deleteCapture(
  jobId: string,
  sessionId: string,
  captureId: string,
): Promise<void> {
  await Promise.allSettled([
    Filesystem.deleteFile({
      path: getPhotoPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
    Filesystem.deleteFile({
      path: getSidecarPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
  ]);
}
