"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <Image
        src="/nookleus-lockup.png"
        alt="Nookleus"
        width={200}
        height={136}
        priority
        className="h-16 w-auto mb-8"
      />
      <h1 className="text-2xl font-semibold text-foreground mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-6">
        An unexpected error occurred. Try again, or head back to safety.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white hover:brightness-110 transition-all"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 rounded-lg text-sm font-medium ring-1 ring-border hover:bg-accent transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
