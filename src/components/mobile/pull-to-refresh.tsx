"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCapacitor } from "@/lib/mobile/use-capacitor";
import { usePullToRefresh } from "@/lib/mobile/use-pull-to-refresh";
import { resistedReveal } from "@/lib/mobile/pull-resistance";

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

  // Coordinate with the WKWebView's native rubber-band: while this native-only
  // surface is mounted, clamp the document's own vertical overscroll so the
  // browser bounce doesn't visibly fight the in-app pull-to-refresh — the
  // spinner owns the overscroll. Scoped to the document element and gated on
  // the native app; mobile Safari and the home-screen PWA keep the browser's
  // own pull-to-refresh untouched. Restored on unmount (#677).
  //
  // Caveat: WebKit only honors overscroll-behavior from iOS/Safari 16. On the
  // app's iOS 15 deployment floor this is a silent no-op — the device falls
  // back to the pre-feature baseline (native bounce + custom pull, uncoordinated),
  // not a regression. Validate AC#5's feel on an iOS 16+ device.
  useEffect(() => {
    if (!native) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("overscroll-behavior-y");
    root.style.setProperty("overscroll-behavior-y", "contain");
    return () => {
      if (prev) root.style.setProperty("overscroll-behavior-y", prev);
      else root.style.removeProperty("overscroll-behavior-y");
    };
  }, [native]);

  if (!native) return <>{children}</>;

  // While the finger is down, the row follows it through a rubber-band curve:
  // it tracks ~1:1 at first, then stiffens, so you can never yank it open past
  // the spinner row (#677). Once a reload is running it parks at the full row.
  const pulling = !refreshing && pullDistance > 0;
  const reveal = refreshing ? SPINNER_ROW : resistedReveal(pullDistance, SPINNER_ROW);
  const visible = refreshing || pullDistance > 0;

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden",
          // Animate the height only when NOT actively dragging: a crisp,
          // un-eased follow during the pull, then a smooth spring on retract
          // (release below threshold) and on the spinner parking/leaving.
          !pulling && "transition-[height] duration-200 ease-out",
        )}
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
