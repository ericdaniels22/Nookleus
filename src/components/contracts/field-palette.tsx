"use client";

import { Type, PenTool, Calendar, Tag, Keyboard, CheckSquare } from "lucide-react";
import type { OverlayFieldType } from "@/lib/contracts/types";

const PALETTE: { type: OverlayFieldType; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { type: "merge", label: "Merge field", Icon: Type },
  { type: "signature", label: "Signature", Icon: PenTool },
  { type: "date", label: "Date", Icon: Calendar },
  { type: "label", label: "Label", Icon: Tag },
  { type: "input", label: "Input", Icon: Keyboard },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare },
];

interface Props {
  onReplacePdf: () => void;
  templateName: string;
  templateDescription: string | null;
  signerCount: 1 | 2;
  signerRoleLabel: string;
  onMetaChange: (next: {
    name?: string;
    description?: string | null;
    signer_count?: 1 | 2;
    signer_role_label?: string;
  }) => void;
}

export default function FieldPalette({
  onReplacePdf,
  templateName,
  templateDescription,
  signerCount,
  signerRoleLabel,
  onMetaChange,
}: Props) {
  return (
    <aside className="w-64 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Drag onto page
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {PALETTE.map(({ type, label, Icon }) => (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-overlay-field-type", type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="cursor-grab active:cursor-grabbing flex flex-col items-center gap-1 p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-accent transition-colors"
            >
              <Icon size={18} />
              <span className="text-[11px] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Template</h3>
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            value={templateName}
            onChange={(e) => onMetaChange({ name: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Description</label>
          <textarea
            value={templateDescription ?? ""}
            onChange={(e) => onMetaChange({ description: e.target.value || null })}
            rows={2}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Signer role label</label>
          <input
            value={signerRoleLabel}
            onChange={(e) => onMetaChange({ signer_role_label: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Signer count</label>
          <div className="mt-1 flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onMetaChange({ signer_count: n as 1 | 2 })}
                className={`flex-1 px-2 py-1.5 text-sm rounded border ${
                  signerCount === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-background"
                }`}
              >
                {n} signer{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 border-t border-border">
        <button
          type="button"
          onClick={onReplacePdf}
          className="w-full px-3 py-2 text-sm rounded border border-border hover:bg-accent"
        >
          Replace PDF
        </button>
      </div>
    </aside>
  );
}
