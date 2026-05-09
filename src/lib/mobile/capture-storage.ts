import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { CaptureSidecar, PendingCapture } from "./capture-types";
import { encrypt, decrypt } from "./crypto-vault";

const ROOT = "pending-uploads";
const DIRECTORY = Directory.Documents;

type WritableSidecar = Omit<
  CaptureSidecar,
  "upload_state" | "retry_count" | "last_error" | "last_attempt_at" | "worker_owner_pid"
> &
  Partial<
    Pick<
      CaptureSidecar,
      "upload_state" | "retry_count" | "last_error" | "last_attempt_at" | "worker_owner_pid"
    >
  >;

export function getSessionDir(jobId: string, sessionId: string) {
  return `${ROOT}/${jobId}/${sessionId}`;
}

export function getPhotoPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.jpg`;
}

export function getSidecarPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.json`;
}

export function getEncryptedPhotoPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.jpg.enc`;
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
  sidecar: WritableSidecar;
}): Promise<void> {
  const { base64Data, sidecar } = args;
  const { job_id, capture_session_id, client_capture_id } = sidecar;
  await ensureSessionDir(job_id, capture_session_id);

  // Decode base64 → blob → encrypt → re-encode → write .jpg.enc
  const plainBuf = base64ToBuf(base64Data);
  const plainBlob = new Blob([plainBuf], { type: "image/jpeg" });
  const encBlob = await encrypt(plainBlob);
  const encB64 = bufToBase64(await encBlob.arrayBuffer());

  await Filesystem.writeFile({
    path: getEncryptedPhotoPath(job_id, capture_session_id, client_capture_id),
    data: encB64,
    directory: DIRECTORY,
  });

  // Sidecar: write upload-state defaults if caller didn't supply
  const fullSidecar: CaptureSidecar = {
    upload_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
    ...sidecar,
  } as CaptureSidecar;

  await Filesystem.writeFile({
    path: getSidecarPath(job_id, capture_session_id, client_capture_id),
    data: JSON.stringify(fullSidecar, null, 2),
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
  // Try encrypted first; fall back to plaintext if .enc missing.
  const encPath = getEncryptedPhotoPath(jobId, sessionId, captureId);
  const plainPath = getPhotoPath(jobId, sessionId, captureId);

  try {
    const r = await Filesystem.readFile({ path: encPath, directory: DIRECTORY });
    const encB64 = typeof r.data === "string" ? r.data : await blobToBase64(r.data);
    const encBlob = new Blob([base64ToBuf(encB64)]);
    const plainBlob = await decrypt(encBlob);
    const plainB64 = bufToBase64(await plainBlob.arrayBuffer());
    return `data:image/jpeg;base64,${plainB64}`;
  } catch {
    // Fallback for any leftover unencrypted file (pre-migration smoke)
    const r = await Filesystem.readFile({ path: plainPath, directory: DIRECTORY });
    const plainB64 =
      typeof r.data === "string" ? r.data : await blobToBase64(r.data);
    return `data:image/jpeg;base64,${plainB64}`;
  }
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
      path: getEncryptedPhotoPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
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

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
