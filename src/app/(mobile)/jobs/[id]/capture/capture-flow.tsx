"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Smartphone } from "lucide-react";
import CameraView from "@/components/mobile/camera-view";
import ReviewScreen from "@/components/mobile/review-screen";
import { useCapacitor } from "@/lib/mobile/use-capacitor";

interface CaptureFlowProps {
  jobId: string;
}

type Step = "camera" | "review";

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CaptureFlow({ jobId }: CaptureFlowProps) {
  const router = useRouter();
  const { isNative, ready } = useCapacitor();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("camera");

  useEffect(() => {
    if (sessionId === null) setSessionId(generateSessionId());
  }, [sessionId]);

  if (!ready) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-black text-white">
        <span className="text-sm opacity-70">Preparing capture&hellip;</span>
      </div>
    );
  }

  if (!isNative) {
    return <DesktopFallback jobId={jobId} />;
  }

  if (sessionId === null) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-black text-white">
        <span className="text-sm opacity-70">Initializing session&hellip;</span>
      </div>
    );
  }

  const exitToJob = () => {
    router.push(`/jobs/${jobId}`);
  };

  if (step === "camera") {
    return (
      <CameraView
        jobId={jobId}
        sessionId={sessionId}
        onDone={() => setStep("review")}
        onAbort={exitToJob}
      />
    );
  }

  return (
    <ReviewScreen
      jobId={jobId}
      sessionId={sessionId}
      onBackToCamera={() => setStep("camera")}
      onExit={exitToJob}
    />
  );
}

function DesktopFallback({ jobId }: { jobId: string }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Smartphone className="h-5 w-5" />
        </div>
        <h1 className="mb-2 text-lg font-semibold">Capture is mobile-only</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          The in-app camera ships in the Nookleus iOS app. On desktop, use the
          photo upload modal on the job detail page to add photos.
        </p>
        <a
          href={`/jobs/${jobId}`}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Camera className="h-4 w-4" />
          Back to job
        </a>
      </div>
    </div>
  );
}
