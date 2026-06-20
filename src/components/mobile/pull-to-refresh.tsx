"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapacitor } from "@/lib/mobile/use-capacitor";
import { usePullToRefresh } from "@/lib/mobile/use-pull-to-refresh";

// Height the spinner row settles to while a reload runs; the pull reveals it
// gradually (with light resistance) on the way there.
const SPINNER_ROW = 56;

/**
 * Native-only swipe-to-refresh shell. On the Capacitor app it wraps its
 * children in a touch surface that reveals a spinner on a downward pull from
 * the top and runs `onRefresh` once past the threshold. Everywhere else
 * (mobile Safari, home-screen PWA) it is a plain passthrough, leaving the
 * browser's own pull-to-refresh untouched.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const { isNative, ready } = useCapacitor();
  const native = ready && isNative === true;
  const { onTouchStart, onTouchMove, onTouchEnd, pullDistance, refreshing } =
    usePullToRefresh({ onRefresh });

  if (!native) return <>{children}</>;

  const reveal = refreshing
    ? SPINNER_ROW
    : Math.min(pullDistance * 0.5, SPINNER_ROW);
  const visible = refreshing || pullDistance > 0;

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: reveal }}
        aria-hidden={!visible}
      >
        <Loader2
          className={cn("animate-spin text-muted-foreground")}
          size={24}
          style={{ opacity: visible ? 1 : 0 }}
        />
      </div>
      {children}
    </div>
  );
}
