import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto-vault";
import { readDimensions } from "./exif-read";
import {
  deleteCapture,
  getEncryptedPhotoPath,
  getSidecarPath,
  readSidecar,
} from "./capture-storage";
import type { CaptureSidecar } from "./capture-types";

const ROOT = "pending-uploads";
const DIRECTORY = Directory.Documents;
const MAX_PARALLEL = 3;
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 30000] as const;
const ERROR_TRUNCATE_LEN = 200;

export type QueueItem = CaptureSidecar & {
  thumbnail_data_url?: string;
};

export interface QueueCounts {
  pending: number;
  uploading: number;
  failed: number;
  synced: number;
}

export interface DrainOptions {
  budgetMs?: number;
}

export interface UploadQueueDeps {
  supabase: SupabaseClient;
  organizationId: string;
  takenBy: string;
  onChange: () => void;
}

export function computeBackoffMs(retryCount: number): number | null {
  if (retryCount >= MAX_RETRIES) return null;
  return BACKOFF_MS[retryCount];
}

export function isStaleUploadingClaim(
  s: Pick<CaptureSidecar, "upload_state" | "worker_owner_pid">,
  currentPid: string,
): boolean {
  return s.upload_state === "uploading" && s.worker_owner_pid !== currentPid;
}

export class UploadQueueWorker {
  private readonly thisPid: string;
  private deps: UploadQueueDeps;
  private inflight = 0;
  private items: Map<string, CaptureSidecar> = new Map();

  constructor(deps: UploadQueueDeps) {
    this.deps = deps;
    this.thisPid = crypto.randomUUID();
  }

  /** Re-scan disk; recover orphaned `uploading` claims from prior worker pids. */
  async scanAll(): Promise<void> {
    this.items.clear();
    const all = await listAllSidecars();
    for (const sc of all) {
      if (isStaleUploadingClaim(sc, this.thisPid)) {
        const recovered: CaptureSidecar = {
          ...sc,
          upload_state: "pending",
          worker_owner_pid: null,
        };
        await persistSidecar(recovered);
        this.items.set(sc.client_capture_id, recovered);
      } else {
        this.items.set(sc.client_capture_id, sc);
      }
    }
    this.deps.onChange();
  }

  counts(): QueueCounts {
    const c: QueueCounts = { pending: 0, uploading: 0, failed: 0, synced: 0 };
    for (const s of this.items.values()) c[s.upload_state]++;
    return c;
  }

  list(): CaptureSidecar[] {
    return [...this.items.values()].sort((a, b) =>
      a.taken_at.localeCompare(b.taken_at),
    );
  }

  async drain(opts: DrainOptions = {}): Promise<void> {
    const startedAt = Date.now();
    const budget = opts.budgetMs ?? Infinity;

    const eligible = (): CaptureSidecar[] =>
      [...this.items.values()].filter((s) => {
        if (s.upload_state === "pending") {
          if (s.last_attempt_at == null) return true;
          const due = new Date(s.last_attempt_at).getTime() +
            (computeBackoffMs(s.retry_count - 1) ?? 0);
          return Date.now() >= due;
        }
        return false;
      });

    while (Date.now() - startedAt < budget) {
      if (this.inflight >= MAX_PARALLEL) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const next = eligible()[0];
      if (!next) break;
      this.inflight++;
      this.uploadOne(next).finally(() => {
        this.inflight--;
      });
    }
    while (this.inflight > 0) await new Promise((r) => setTimeout(r, 100));
  }

  async retry(captureId: string): Promise<void> {
    const s = [...this.items.values()].find(
      (x) => x.client_capture_id === captureId,
    );
    if (!s) return;
    const reset: CaptureSidecar = {
      ...s,
      upload_state: "pending",
      retry_count: 0,
      last_error: null,
      last_attempt_at: null,
      worker_owner_pid: null,
    };
    await persistSidecar(reset);
    this.items.set(captureId, reset);
    this.deps.onChange();
    await this.drain();
  }

  async deleteFromQueue(captureId: string): Promise<void> {
    const s = [...this.items.values()].find(
      (x) => x.client_capture_id === captureId,
    );
    if (!s) return;
    await deleteCapture(s.job_id, s.capture_session_id, captureId);
    this.items.delete(captureId);
    this.deps.onChange();
  }

  private async uploadOne(sidecar: CaptureSidecar): Promise<void> {
    const { job_id, capture_session_id, client_capture_id } = sidecar;

    const claimed: CaptureSidecar = {
      ...sidecar,
      upload_state: "uploading",
      worker_owner_pid: this.thisPid,
      last_attempt_at: new Date().toISOString(),
    };
    await persistSidecar(claimed);
    this.items.set(client_capture_id, claimed);
    this.deps.onChange();

    try {
      if (
        typeof window !== "undefined" &&
        window.localStorage?.getItem("65c-force-upload-fail") === "1"
      ) {
        const r = await fetch("/api/test/photo-upload-fail", { method: "POST" });
        if (!r.ok) throw new Error(`synthetic_test_failure: HTTP ${r.status}`);
      }

      const encR = await Filesystem.readFile({
        path: getEncryptedPhotoPath(job_id, capture_session_id, client_capture_id),
        directory: DIRECTORY,
      });
      const encB64 =
        typeof encR.data === "string" ? encR.data : await blobToBase64(encR.data);
      const encBlob = new Blob([base64ToBuf(encB64)]);
      const blob = await decrypt(encBlob);

      const dims = await readDimensions(blob);

      const ext = "jpg";
      const ts = Date.now();
      const rand6 = Math.random().toString(36).slice(2, 8);
      const storagePath = `${this.deps.organizationId}/${job_id}/${ts}-${rand6}.${ext}`;

      const upload = async () =>
        this.deps.supabase.storage
          .from("photos")
          .upload(storagePath, blob, {
            contentType: "image/jpeg",
            upsert: false,
          });

      let upR = await upload();
      if (upR.error && (upR.error as any).status === 401) {
        await this.deps.supabase.auth.refreshSession();
        upR = await upload();
      }
      if (upR.error) throw upR.error;

      const ins = await this.deps.supabase.from("photos").insert({
        organization_id: this.deps.organizationId,
        job_id,
        storage_path: storagePath,
        uploaded_from: "mobile",
        client_capture_id,
        taken_by: this.deps.takenBy,
        taken_at: sidecar.taken_at,
        caption: sidecar.caption,
        width: dims.width,
        height: dims.height,
        file_size: blob.size,
      }).select("id").single();

      let photoId: string;
      if (ins.error && (ins.error as any).code === "23505") {
        const { data } = await this.deps.supabase
          .from("photos")
          .select("id")
          .eq("organization_id", this.deps.organizationId)
          .eq("client_capture_id", client_capture_id)
          .single();
        if (!data) throw new Error("conflict_but_no_existing_row");
        photoId = data.id;
      } else if (ins.error) {
        throw ins.error;
      } else {
        photoId = ins.data!.id;
      }

      if (sidecar.tag_ids.length > 0) {
        const rows = sidecar.tag_ids.map((tag_id) => ({
          organization_id: this.deps.organizationId,
          photo_id: photoId,
          tag_id,
        }));
        const t = await this.deps.supabase
          .from("photo_tag_assignments")
          .insert(rows);
        if (t.error) console.warn("[65c] tag insert failed", t.error);
      }

      await deleteCapture(job_id, capture_session_id, client_capture_id);
      this.items.delete(client_capture_id);
      this.deps.onChange();
    } catch (err: any) {
      const errMsg = String(err?.message ?? err).slice(0, ERROR_TRUNCATE_LEN);
      const newRetryCount = sidecar.retry_count + 1;
      const nextState =
        computeBackoffMs(newRetryCount - 1) === null ? "failed" : "pending";
      const failed: CaptureSidecar = {
        ...sidecar,
        upload_state: nextState,
        retry_count: newRetryCount,
        last_error: errMsg,
        last_attempt_at: new Date().toISOString(),
        worker_owner_pid: null,
      };
      await persistSidecar(failed);
      this.items.set(client_capture_id, failed);
      this.deps.onChange();
    }
  }
}

async function listAllSidecars(): Promise<CaptureSidecar[]> {
  const out: CaptureSidecar[] = [];
  let jobDirs: string[] = [];
  try {
    const r = await Filesystem.readdir({ path: ROOT, directory: DIRECTORY });
    jobDirs = r.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return out;
  }

  for (const jobDir of jobDirs) {
    const sessionsR = await Filesystem.readdir({
      path: `${ROOT}/${jobDir}`,
      directory: DIRECTORY,
    }).catch(() => ({ files: [] as Array<string | { name: string }> }));
    for (const sRaw of sessionsR.files) {
      const sess = typeof sRaw === "string" ? sRaw : sRaw.name;
      const filesR = await Filesystem.readdir({
        path: `${ROOT}/${jobDir}/${sess}`,
        directory: DIRECTORY,
      }).catch(() => ({ files: [] as Array<string | { name: string }> }));
      const names = filesR.files.map((f) => (typeof f === "string" ? f : f.name));
      const sidecarNames = names.filter((n) => n.endsWith(".json"));
      for (const name of sidecarNames) {
        const captureId = name.replace(/\.json$/, "");
        try {
          const sc = await readSidecar(jobDir, sess, captureId);
          out.push(sc);
        } catch {
          // skip damaged
        }
      }
    }
  }
  return out;
}

async function persistSidecar(s: CaptureSidecar): Promise<void> {
  await Filesystem.writeFile({
    path: getSidecarPath(s.job_id, s.capture_session_id, s.client_capture_id),
    data: JSON.stringify(s, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
