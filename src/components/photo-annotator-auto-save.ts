import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase";
import type { AnnotationData } from "@/lib/jobs/photo-annotation-format";
import { persistPhotoMarkup } from "@/lib/jobs/persist-photo-markup";
import { persistAnnotatedRender } from "@/lib/jobs/persist-annotated-render";

/** ~1s feels instant to the editor but still collapses a flurry of strokes into
 *  one write. ADR 0024 calls for a "cheap, debounced" markup save. */
const MARKUP_DEBOUNCE_MS = 1000;

/** How many times a failed markup upsert is retried before we surface a warning.
 *  Transient blips (a dropped packet, a brief 5xx) recover silently; only a
 *  durable outage reaches the user. */
const MAX_MARKUP_RETRIES = 3;

/** Backoff is capped so a long outage doesn't stretch to absurd retry gaps. */
const MAX_BACKOFF_MS = 30_000;

type SupabaseLike = ReturnType<typeof createClient>;

interface AnnotatorPhoto {
  id: string;
  storage_path: string;
  annotated_path?: string | null;
}

export interface UseAnnotatorAutoSaveConfig {
  supabase: SupabaseLike;
  /** The photo currently open in the annotator (null before one is selected). */
  photo: AnnotatorPhoto | null;
  organizationId: string | null;
  /** Flattens the live canvas to a PNG blob. Injected so the hook stays
   *  Fabric-free and unit-testable; the component wires it to `canvas.toDataURL`. */
  captureFlattenedBlob: () => Promise<Blob | null>;
  /** Fired after a successful rebuild so the host can refresh its photo list. */
  onPersisted?: () => void;
}

export interface AnnotatorAutoSaveController {
  /** Queue a debounced markup-only upsert for the current photo. */
  scheduleMarkupSave: (data: AnnotationData) => void;
  /** Flush any pending markup, then rebuild the flattened annotated render. */
  flushAndRebuild: (photo?: AnnotatorPhoto | null) => Promise<void>;
}

/**
 * Controller for the annotator's auto-save (issue #807, ADR 0024 split write).
 *
 * Every edit calls {@link AnnotatorAutoSaveController.scheduleMarkupSave}, which
 * debounces a cheap `photo_annotations.annotation_data` upsert. The expensive
 * flattened render (Storage upload + `photos.annotated_path`) is rebuilt only via
 * {@link AnnotatorAutoSaveController.flushAndRebuild} on leave/close — it never
 * runs on a keystroke.
 */
export function useAnnotatorAutoSave(
  config: UseAnnotatorAutoSaveConfig,
): AnnotatorAutoSaveController {
  // Latest config, read by callbacks so they never go stale without re-binding.
  const configRef = useRef(config);
  configRef.current = config;

  // Latest unsaved markup; held until a write SUCCEEDS so a failed attempt can
  // be retried (and a fresh edit mid-retry simply supersedes it).
  const pendingMarkupRef = useRef<AnnotationData | null>(null);
  // One timer slot drives both the debounce and the backoff retries.
  const markupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);

  const flushMarkup = useCallback(
    async (targetPhoto?: AnnotatorPhoto | null) => {
      if (markupTimerRef.current) {
        clearTimeout(markupTimerRef.current);
        markupTimerRef.current = null;
      }
      const data = pendingMarkupRef.current;
      if (!data) return;

      const { supabase, organizationId } = configRef.current;
      // The pending markup belongs to whichever photo was open when it was
      // queued. On the debounce path that's still the current photo; on the
      // leave path the host passes the OUTGOING photo explicitly, so a write
      // that lands after the host has advanced to the next photo can't be
      // misattributed to it.
      const photo = targetPhoto ?? configRef.current.photo;
      if (!photo) return;

      try {
        await persistPhotoMarkup(supabase, {
          photoId: photo.id,
          organizationId,
          annotationData: data,
        });
        // Success: drop the pending edit and reset the backoff ladder. Silent.
        pendingMarkupRef.current = null;
        retriesRef.current = 0;
      } catch {
        retriesRef.current += 1;
        if (retriesRef.current > MAX_MARKUP_RETRIES) {
          // Durable failure: give up on this edit and warn the user once.
          retriesRef.current = 0;
          pendingMarkupRef.current = null;
          toast.error("Couldn't save your annotations. Check your connection.");
          return;
        }
        const delay = Math.min(
          MARKUP_DEBOUNCE_MS * 2 ** (retriesRef.current - 1),
          MAX_BACKOFF_MS,
        );
        // Retry against the SAME photo this attempt targeted.
        markupTimerRef.current = setTimeout(() => {
          void flushMarkup(targetPhoto);
        }, delay);
      }
    },
    [],
  );

  /** Best-effort synchronous flush for teardown paths (unmount / tab-close /
   *  background) where we can't run the full async close sequence. Fires only
   *  the CHEAP markup write and does not await it; the expensive rebuild is left
   *  to the explicit close handler while the page is still alive. */
  const flushPendingMarkupNow = useCallback(() => {
    if (markupTimerRef.current) {
      clearTimeout(markupTimerRef.current);
      markupTimerRef.current = null;
    }
    const data = pendingMarkupRef.current;
    if (!data) return;
    const { supabase, photo, organizationId } = configRef.current;
    if (!photo) return;
    pendingMarkupRef.current = null;
    void persistPhotoMarkup(supabase, {
      photoId: photo.id,
      organizationId,
      annotationData: data,
    }).catch(() => {
      // Teardown is best-effort; nothing left to surface a warning to.
    });
  }, []);

  // Safety nets for an edit caught mid-debounce when the annotator goes away:
  //   • unmount   — dialog closed in-app (React cleanup runs)
  //   • pagehide  — tab close / refresh / address-bar nav (cleanup does NOT run)
  //   • visibilitychange→hidden — app backgrounded (the common iOS exit)
  useEffect(() => {
    const onPageHide = () => flushPendingMarkupNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingMarkupNow();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushPendingMarkupNow();
    };
  }, [flushPendingMarkupNow]);

  const scheduleMarkupSave = useCallback(
    (data: AnnotationData) => {
      pendingMarkupRef.current = data;
      if (markupTimerRef.current) clearTimeout(markupTimerRef.current);
      markupTimerRef.current = setTimeout(() => {
        void flushMarkup();
      }, MARKUP_DEBOUNCE_MS);
    },
    [flushMarkup],
  );

  const flushAndRebuild = useCallback(
    async (overridePhoto?: AnnotatorPhoto | null) => {
      const { supabase, captureFlattenedBlob, onPersisted } = configRef.current;
      const photo = overridePhoto ?? configRef.current.photo;

      // Grab the live pixels FIRST — captureFlattenedBlob snapshots the canvas
      // synchronously, so the outgoing photo's render is locked in before the
      // caller swaps to the next photo (its async tail is canvas-independent).
      const blobPromise = captureFlattenedBlob();

      // Then flush the cheap markup so it can't be lost behind the rebuild —
      // attributed to the SAME photo we're rebuilding, not whatever is current
      // by the time this async tail runs.
      await flushMarkup(photo);

      if (!photo) return;
      const blob = await blobPromise;
      if (!blob) return;

      await persistAnnotatedRender(supabase, {
        photoId: photo.id,
        storagePath: photo.storage_path,
        previousAnnotatedPath: photo.annotated_path,
        blob,
        token: Date.now().toString(36),
      });

      onPersisted?.();
    },
    [flushMarkup],
  );

  // Both callbacks are stable (useCallback with empty/stable deps), so the
  // controller object is too — the host can list it in effect deps without
  // re-subscribing canvas listeners on every render.
  return useMemo(
    () => ({ scheduleMarkupSave, flushAndRebuild }),
    [scheduleMarkupSave, flushAndRebuild],
  );
}
