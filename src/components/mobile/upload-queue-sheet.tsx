"use client";

import { useUploadQueue } from "@/lib/mobile/upload-queue-context";
import { listSessionCaptures } from "@/lib/mobile/capture-storage";
import { useEffect, useState } from "react";
import type { CaptureSidecar } from "@/lib/mobile/capture-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadQueueSheet({ open, onOpenChange }: Props) {
  const { list, retry, deleteFromQueue } = useUploadQueue();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      const sessions = new Map<string, CaptureSidecar[]>();
      for (const s of list) {
        const k = `${s.job_id}/${s.capture_session_id}`;
        if (!sessions.has(k)) sessions.set(k, []);
        sessions.get(k)!.push(s);
      }
      for (const [k, items] of sessions) {
        const [jobId, sessId] = k.split("/");
        const captures = await listSessionCaptures(jobId, sessId);
        for (const c of captures) {
          if (items.find((i) => i.client_capture_id === c.sidecar.client_capture_id)) {
            next[c.sidecar.client_capture_id] = c.thumbnail_data_url;
          }
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, list]);

  if (!open) return null;

  const failedItems = list.filter((s) => s.upload_state === "failed");

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={() => onOpenChange(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-h-[80vh] bg-popover text-popover-foreground rounded-t-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-popover px-4 py-3 border-b border-border flex justify-between items-center">
          <h2 className="font-semibold">Upload queue</h2>
          <button onClick={() => onOpenChange(false)} aria-label="Close">×</button>
        </div>
        {list.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">All synced</div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {list.map((s) => (
              <li key={s.client_capture_id} className="px-4 py-3 flex gap-3 items-start">
                {thumbs[s.client_capture_id] && (
                  <img
                    src={thumbs[s.client_capture_id]}
                    alt=""
                    className="w-16 h-16 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    Capture {new Date(s.taken_at).toLocaleTimeString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.upload_state === "uploading" && "Uploading…"}
                    {s.upload_state === "pending" && "Pending"}
                    {s.upload_state === "failed" &&
                      `Failed: ${s.last_error ?? "unknown error"}`}
                  </div>
                  {s.upload_state === "failed" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => retry(s.client_capture_id)}
                        className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => deleteFromQueue(s.client_capture_id)}
                        className="text-xs px-3 py-1 rounded border border-input"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {failedItems.length > 1 && (
          <div className="sticky bottom-0 bg-popover border-t border-border p-3">
            <button
              onClick={() => Promise.all(failedItems.map((s) => retry(s.client_capture_id)))}
              className="w-full py-2 rounded bg-primary text-primary-foreground"
            >
              Retry all failed ({failedItems.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
