"use client";

import { useEffect, useRef, useState } from "react";
import { Caveat } from "next/font/google";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const caveat = Caveat({ subsets: ["latin"], display: "swap", weight: "400" });

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  title?: string;
}

type Tab = "draw" | "type";

export default function SignaturePadModal({ open, onClose, onConfirm, title = "Sign here" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [tab, setTab] = useState<Tab>("draw");
  const [typedName, setTypedName] = useState("");

  useEffect(() => {
    if (!open) return;
    if (typeof document !== "undefined" && document.fonts?.load) {
      document.fonts.load("60px Caveat").catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "draw" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    setHasInk(false);
    lastPointRef.current = null;
  }, [open, tab]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * e.currentTarget.width,
      y: ((e.clientY - r.top) / r.height) * e.currentTarget.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    drawingRef.current = true;
    lastPointRef.current = { x, y };
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    const last = lastPointRef.current;
    if (last) {
      const midX = (last.x + x) / 2;
      const midY = (last.y + y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, midX, midY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX, midY);
    }
    lastPointRef.current = { x, y };
    setHasInk(true);
  }

  function up() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearDraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    lastPointRef.current = null;
  }

  async function renderTypedToPng(): Promise<string> {
    if (typeof document !== "undefined" && document.fonts?.load) {
      try {
        await document.fonts.load("60px Caveat");
      } catch {
        // System "cursive" fallback acceptable.
      }
    }
    const off = document.createElement("canvas");
    off.width = 600;
    off.height = 200;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context for offscreen canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    let size = 60;
    ctx.font = `${size}px Caveat, cursive`;
    while (ctx.measureText(typedName).width > 560 && size > 28) {
      size -= 4;
      ctx.font = `${size}px Caveat, cursive`;
    }
    ctx.fillText(typedName, off.width / 2, off.height / 2);
    return off.toDataURL("image/png");
  }

  async function handleInsert() {
    if (tab === "draw") {
      if (!canvasRef.current) return;
      onConfirm(canvasRef.current.toDataURL("image/png"));
    } else {
      const dataUrl = await renderTypedToPng();
      onConfirm(dataUrl);
    }
    onClose();
  }

  const insertDisabled =
    tab === "draw" ? !hasInk : typedName.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(100vw-2rem,40rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div role="tablist" aria-label="Signature input mode" className="flex border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "draw"}
            aria-controls="signature-draw-panel"
            onClick={() => setTab("draw")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "draw"
                ? "border-[var(--brand-primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Draw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "type"}
            aria-controls="signature-type-panel"
            onClick={() => setTab("type")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "type"
                ? "border-[var(--brand-primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Type
          </button>
        </div>

        <div role="tabpanel" id="signature-draw-panel" hidden={tab !== "draw"}>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            className="w-full bg-white border border-border rounded touch-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={clearDraw}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>

        <div role="tabpanel" id="signature-type-panel" hidden={tab !== "type"}>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full name"
            className="w-full px-3 py-2 text-sm border border-border rounded bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            autoFocus
          />
          <div
            className={`${caveat.className} mt-3 w-full h-[200px] bg-white border border-border rounded flex items-center justify-center text-5xl text-black overflow-hidden`}
            aria-hidden="true"
          >
            {typedName.trim() || (
              <span className="text-muted-foreground text-base font-sans">
                Live preview
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground flex-1">
            I understand this is a legal representation of my signature.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded border border-border"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={insertDisabled}
              className="px-3 py-1.5 text-sm rounded bg-[var(--brand-primary)] text-white disabled:opacity-50"
            >
              Insert
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
