"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  Type, AlignLeft, Hash, Calendar, Phone, Mail, ChevronDown,
  CircleDot, CheckSquare, MapPin, ToggleRight, DollarSign,
} from "lucide-react";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormField } from "@/lib/types";

const FIELD_TYPE_ITEMS: {
  type: FormField["type"];
  label: string;
  icon: typeof Type;
}[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "textarea", label: "Text Area", icon: AlignLeft },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "phone", label: "Phone", icon: Phone },
  { type: "email", label: "Email", icon: Mail },
  { type: "select", label: "Dropdown", icon: ChevronDown },
  { type: "pill", label: "Pill Selector", icon: CircleDot },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
];

const PRESET_ICONS = {
  Phone, Mail, MapPin, ToggleRight, DollarSign, Calendar,
} as const;

export function Palette({
  onInsertType,
  onInsertPreset,
}: {
  onInsertType: (type: FormField["type"]) => void;
  onInsertPreset: (presetKey: string) => void;
}) {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Add Field
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Drag onto canvas, or click to add to last section.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <section>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5 px-1">
            Presets
          </h4>
          <div className="space-y-1">
            {FIELD_PRESETS.map((preset) => {
              const Icon =
                (PRESET_ICONS as Record<string, typeof Type>)[preset.icon] ?? Type;
              return (
                <PaletteItem
                  key={preset.key}
                  id={`preset:${preset.key}`}
                  label={preset.name}
                  description={preset.description}
                  icon={Icon}
                  onClick={() => onInsertPreset(preset.key)}
                />
              );
            })}
          </div>
        </section>
        <section>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5 px-1">
            Field Types
          </h4>
          <div className="space-y-1">
            {FIELD_TYPE_ITEMS.map((item) => (
              <PaletteItem
                key={item.type}
                id={`type:${item.type}`}
                label={item.label}
                icon={item.icon}
                onClick={() => onInsertType(item.type)}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function PaletteItem({
  id,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  id: string;
  label: string;
  description?: string;
  icon: typeof Type;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: "palette-item", paletteId: id },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left text-sm border border-transparent hover:border-border hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
      title={description ?? label}
    >
      <Icon size={14} className="mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-foreground truncate">{label}</div>
        {description && (
          <div className="text-[10px] text-muted-foreground truncate">{description}</div>
        )}
      </div>
    </button>
  );
}
