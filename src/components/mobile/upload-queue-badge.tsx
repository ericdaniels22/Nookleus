"use client";

import { useUploadQueue } from "@/lib/mobile/upload-queue-context";

export function UploadQueueBadge() {
  const { counts } = useUploadQueue();
  const hasFailed = counts.failed > 0;
  const hasActive = counts.uploading + counts.pending > 0;

  if (!hasFailed && !hasActive) return null;

  const count = hasFailed ? counts.failed : counts.uploading + counts.pending;
  const color = hasFailed ? "bg-red-500" : "bg-blue-500";
  const animate = !hasFailed && counts.uploading > 0 ? "animate-pulse" : "";

  return (
    <span
      className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full ${color} ${animate} text-white text-[11px] font-semibold flex items-center justify-center pointer-events-none shadow-md`}
      aria-label={
        hasFailed ? `${count} uploads failed` : `${count} uploading`
      }
    >
      {count}
    </span>
  );
}
