"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PdfPreviewFrame } from "@/components/documents/pdf-preview-frame";
import { toast } from "sonner";
import type { DocumentPdfLayout } from "@/lib/types";

const SAVE_DELAY_MS = 600;

interface LiveLayoutPanelProps {
  estimateId: string;
  previewSrc: string;
  previewTitle: string;
  /** The document's effective layout (server-resolved), so the toggle restores state. */
  layout: DocumentPdfLayout;
  /** Caller holds edit_estimates. */
  canEdit: boolean;
  /** The document is frozen (converted) — layout is read-only. */
  locked: boolean;
}

// Live single-toggle layout panel on the Estimate View (#483).
export function LiveLayoutPanel({
  estimateId,
  previewSrc,
  previewTitle,
  layout: initialLayout,
  canEdit,
  locked,
}: LiveLayoutPanelProps) {
  // A frozen document, or a caller without the edit grant, sees the look but
  // cannot change it (ADR 0012 reuses the edit-document boundary + freeze).
  const readOnly = !canEdit || locked;
  const [layout, setLayout] = useState<DocumentPdfLayout>(initialLayout);
  const [version, setVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The edit currently waiting on the debounce timer — flushed on teardown so a
  // fast navigate-away inside the window doesn't silently drop it.
  const pending = useRef<DocumentPdfLayout | null>(null);
  // The last look the server actually has (what the preview renders), so a
  // failed save can roll the optimistic switch back to a state that agrees with
  // the preview instead of leaving the two silently desynced.
  const savedLayout = useRef<DocumentPdfLayout>(initialLayout);

  const sendLayout = useCallback(
    (next: DocumentPdfLayout, keepalive = false) =>
      fetch(`/api/estimates/${estimateId}/layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        keepalive,
      }),
    [estimateId],
  );

  // Flush the pending edit on unmount instead of merely clearing the timer: the
  // debounce window would otherwise drop the last toggle on a fast navigate-away
  // (easy on a tablet). Mirrors the keepalive flush in use-auto-save.ts (#461).
  // A ref-held closure, rewritten each render, reads the freshest sendLayout.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (timer.current && pending.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const body = pending.current;
      pending.current = null;
      void sendLayout(body, true);
    }
  };
  useEffect(() => () => flushRef.current(), []);

  // The unmount cleanup above fires only on in-app navigation; a hard teardown
  // (tab close, refresh, address-bar nav, iOS backgrounding) never runs React
  // cleanup, so fire the same keepalive flush from the page-lifecycle event too
  // (#477). beforeunload is intentionally avoided (unreliable in iOS WebKit).
  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Debounced autosave: the panel always persists the *complete* snapshot
  // (ADR 0012), seeded from the effective look with switches flipped. On a
  // successful save, bump the preview version so the iframe re-renders live.
  const save = useCallback(
    (next: DocumentPdfLayout) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        timer.current = null;
        pending.current = null;
        const res = await sendLayout(next);
        // On success, record the persisted look and bump the preview version for
        // a live re-render. On failure, roll the switch back to the last saved
        // look (keeping it in sync with the un-reloaded preview) and surface it.
        if (res.ok) {
          savedLayout.current = next;
          setVersion((v) => v + 1);
        } else {
          const { error } = await res
            .json()
            .catch(() => ({ error: undefined as string | undefined }));
          setLayout(savedLayout.current);
          toast.error(error ?? "Couldn't save layout");
        }
      }, SAVE_DELAY_MS);
    },
    [sendLayout],
  );

  const setMarkup = (show_markup: boolean) => {
    if (readOnly) return;
    const next = { ...layout, show_markup };
    setLayout(next); // optimistic
    save(next);
  };

  // version 0 is the untouched server-rendered preview; later versions append a
  // cache-busting param so the iframe (also keyed on src) re-fetches live.
  const src = version === 0 ? previewSrc : `${previewSrc}?v=${version}`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card px-5 py-4">
        <h2 className="text-sm font-medium text-foreground mb-3">Document layout</h2>
        <div className="flex items-start gap-3">
          <Switch
            id="show_markup"
            checked={layout.show_markup}
            disabled={readOnly}
            onCheckedChange={setMarkup}
          />
          <Label htmlFor="show_markup" className="cursor-pointer">
            Show markup row in totals
          </Label>
        </div>
      </div>
      <PdfPreviewFrame key={src} src={src} title={previewTitle} />
    </div>
  );
}
