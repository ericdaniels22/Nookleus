"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { useCapacitor } from "@/lib/mobile/use-capacitor";
import { UploadQueueBadge } from "./upload-queue-badge";
import { UploadQueueSheet } from "./upload-queue-sheet";

const LONG_PRESS_MS = 500;

export default function CaptureFab({ jobId }: { jobId: string }) {
  const { isNative, ready } = useCapacitor();
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  if (!ready || !isNative) return null;

  function onPointerDown() {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  }
  function onPointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  function onClick(e: React.MouseEvent) {
    if (longPressFired.current) e.preventDefault();
  }

  return (
    <>
      <div className="fixed bottom-[max(env(safe-area-inset-bottom),24px)] right-6 z-50">
        <div className="relative inline-block">
          <Link
            href={`/jobs/${jobId}/capture`}
            aria-label="Open camera"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onClick}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
          >
            <Camera className="h-6 w-6" />
          </Link>
          <UploadQueueBadge />
        </div>
      </div>
      <UploadQueueSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
