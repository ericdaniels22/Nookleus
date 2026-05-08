"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { useCapacitor } from "@/lib/mobile/use-capacitor";

export default function CaptureFab({ jobId }: { jobId: string }) {
  const { isNative, ready } = useCapacitor();
  if (!ready || !isNative) return null;
  return (
    <Link
      href={`/jobs/${jobId}/capture`}
      aria-label="Open camera"
      className="fixed bottom-[max(env(safe-area-inset-bottom),24px)] right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
    >
      <Camera className="h-6 w-6" />
    </Link>
  );
}
