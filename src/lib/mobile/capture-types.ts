export type CaptureMode = "rapid" | "tag-after";

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
}

export interface PendingCapture {
  sidecar: CaptureSidecar;
  thumbnail_data_url: string;
}
