"use client";

import { useRef } from "react";
import type { OverlayField } from "@/lib/contracts/types";

interface Props {
  field: OverlayField;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: OverlayField) => void;
  pageWidthPt: number;
  pageHeightPt: number;
}

const TYPE_COLORS: Record<OverlayField["type"], string> = {
  merge: "bg-blue-100 border-blue-400 text-blue-900",
  signature: "bg-purple-100 border-purple-400 text-purple-900",
  date: "bg-green-100 border-green-400 text-green-900",
  label: "bg-zinc-100 border-zinc-400 text-zinc-800",
  input: "bg-amber-100 border-amber-400 text-amber-900",
  checkbox: "bg-pink-100 border-pink-400 text-pink-900",
};

const TYPE_LABEL: Record<OverlayField["type"], (f: OverlayField) => string> = {
  merge: (f) => (f.mergeFieldName ? `{{${f.mergeFieldName}}}` : "Merge field"),
  signature: (f) => `Signature ${f.signerOrder ?? 1}`,
  date: () => "Signed date",
  label: (f) => f.labelText || "Label",
  input: (f) => `Input: ${f.inputLabel ?? f.inputKey ?? "(unlabeled)"}`,
  checkbox: (f) => `☐ ${f.inputLabel ?? f.inputKey ?? "(unlabeled)"}`,
};

export default function OverlayFieldChip({
  field,
  scale,
  selected,
  onSelect,
  onChange,
  pageWidthPt,
  pageHeightPt,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  function startMove(e: React.PointerEvent) {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startFx = field.x;
    const startFy = field.y;

    function move(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      const nextX = clamp(startFx + dx, 0, pageWidthPt - field.width);
      const nextY = clamp(startFy + dy, 0, pageHeightPt - field.height);
      onChange({ ...field, x: nextX, y: nextY });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(corner: "se" | "sw" | "ne" | "nw") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...field };

      function move(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const next = { ...start };
        if (corner.includes("e")) next.width = Math.max(20, start.width + dx);
        if (corner.includes("s")) next.height = Math.max(12, start.height + dy);
        if (corner.includes("w")) {
          next.x = clamp(start.x + dx, 0, start.x + start.width - 20);
          next.width = Math.max(20, start.width - dx);
        }
        if (corner.includes("n")) {
          next.y = clamp(start.y + dy, 0, start.y + start.height - 12);
          next.height = Math.max(12, start.height - dy);
        }
        next.width = Math.min(next.width, pageWidthPt - next.x);
        next.height = Math.min(next.height, pageHeightPt - next.y);
        onChange(next);
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  return (
    <div
      ref={ref}
      onPointerDown={startMove}
      onClick={(e) => e.stopPropagation()}
      className={`absolute border-2 rounded text-xs font-medium select-none flex items-center px-1.5 cursor-move ${
        TYPE_COLORS[field.type]
      } ${selected ? "ring-2 ring-[var(--brand-primary)]" : ""}`}
      style={{
        left: field.x * scale,
        top: field.y * scale,
        width: field.width * scale,
        height: field.height * scale,
      }}
    >
      <span className="truncate flex-1">{TYPE_LABEL[field.type](field)}</span>
      {selected && (
        <>
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <span
              key={c}
              data-handle={c}
              onPointerDown={startResize(c)}
              className="absolute w-2 h-2 bg-[var(--brand-primary)] border border-white rounded-sm"
              style={{
                left: c.includes("w") ? -4 : "auto",
                right: c.includes("e") ? -4 : "auto",
                top: c.includes("n") ? -4 : "auto",
                bottom: c.includes("s") ? -4 : "auto",
                cursor: `${c}-resize`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
