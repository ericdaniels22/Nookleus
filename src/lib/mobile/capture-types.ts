export type CaptureMode = "rapid" | "tag-after";

export type UploadState = "pending" | "uploading" | "failed" | "synced";

export interface CaptureSidecar {
  client_capture_id: string;
  job_id: string;
  capture_session_id: string;
  taken_at: string;
  capture_mode: CaptureMode;
  width: number;
  height: number;
  orientation: number;
  caption: string | null;
  tag_ids: string[];

  // 65c upload state (defaults set on write)
  upload_state: UploadState;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  worker_owner_pid: string | null;
}

export interface PendingCapture {
  sidecar: CaptureSidecar;
  thumbnail_data_url: string;
}
