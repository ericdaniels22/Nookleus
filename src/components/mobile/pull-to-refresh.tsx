"use client";

import { useCallback, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCapacitor } from "@/lib/mobile/use-capacitor";
import { usePullToRefresh } from "@/lib/mobile/use-pull-to-refresh";

// Height the spinner row settles to while a reload runs; the pull reveals it
// gradually (with light resistance) on the way there.
const SPINNER_ROW = 56;

// Shown when a pull-triggered reload can't reach the server (e.g. weak signal
// on a job site). The on-screen data is left untouched; the user can pull
// again to retry. Overridable per surface via the `errorMessage` prop.
const DEFAULT_ERROR_MESSAGE = "Couldn't refresh — check your connection.";

/**
 * Native-only swipe-to-refresh shell. On the Capacitor app it wraps its
 * children in a touch surface that reveals a spinner on a downward pull from
 * the top and runs `onRefresh` once past the threshold. Everywhere else
 * (mobile Safari, home-screen PWA) it is a plain passthrough, leaving the
 * browser's own pull-to-refresh untouched.
 *
 * Pass `disabled` to stand the gesture down while an overlay is open on top of
 * the page (photo viewer, edit dialogs, compose-email) so swipes drive the
 * overlay's own gestures instead of refreshing the page underneath (#678).
 */
export function PullToRefresh({
  onRefresh,
  children,
  errorMessage = DEFAULT_ERROR_MESSAGE,
  disabled = false,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  errorMessage?: string;
  disabled?: boolean;
}) {
  const { isNative, ready } = useCapacitor();
  const native = ready && isNative === true;

  // Own the failure *policy* here so it's shared by every surface that uses
  // pull-to-refresh: if the reload rejects, keep the children on screen
  // (we never unmount them) and toast. Catching here also means the hook only
  // ever sees a resolved promise, so its spinner retracts cleanly and the
  // rejection never escapes as unhandled.
  const handleRefresh = useCallback(async () => {
    try {
      await onRefresh();
    } catch {
      toast.error(errorMessage);
    }
  }, [onRefresh, errorMessage]);

  const { onTouchStart, onTouchMove, onTouchEnd, pullDistance, refreshing } =
    usePullToRefresh({ onRefresh: handleRefresh, disabled });

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
