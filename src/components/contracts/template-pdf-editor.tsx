"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import TemplatePdfUploadZone from "./template-pdf-upload-zone";
import PdfCanvas from "./pdf-canvas";
import OverlayFieldChip from "./overlay-field-chip";
import FieldPalette from "./field-palette";
import FieldInspector from "./field-inspector";
import { SYSTEM_MERGE_FIELDS } from "@/lib/contracts/merge-fields";
import {
  buildMergeFieldRegistry,
  type MergeFieldDefinition,
} from "@/lib/contracts/merge-field-registry";
import { isPanThresholdExceeded } from "@/lib/contracts/pan-threshold";
import type { ContractTemplate, OverlayField, OverlayFieldType } from "@/lib/contracts/types";
import type { FormConfig } from "@/lib/types";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

interface Props {
  initial: ContractTemplate;
}

const DEFAULT_FIELD_SIZE: Record<OverlayFieldType, { width: number; height: number; fontSize: number }> = {
  merge: { width: 200, height: 16, fontSize: 11 },
  signature: { width: 180, height: 40, fontSize: 11 },
  date: { width: 100, height: 16, fontSize: 11 },
  label: { width: 200, height: 16, fontSize: 11 },
  input: { width: 200, height: 18, fontSize: 11 },
  checkbox: { width: 14, height: 14, fontSize: 11 },
};

export default function TemplatePdfEditor({ initial }: Props) {
  const [template, setTemplate] = useState<ContractTemplate>(initial);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [zoom, setZoom] = useState(1);
  const [mergeRegistry, setMergeRegistry] = useState<MergeFieldDefinition[]>(
    () => buildMergeFieldRegistry({ sections: [] }, SYSTEM_MERGE_FIELDS),
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const suppressClickRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const panEnabled = zoom > 1;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/intake-form")
      .then((r) => r.json())
      .then((j: { config?: FormConfig }) => {
        if (cancelled) return;
        const cfg: FormConfig = j?.config ?? { sections: [] };
        setMergeRegistry(buildMergeFieldRegistry(cfg, SYSTEM_MERGE_FIELDS));
      })
      .catch(() => {
        // Fall back to system-only registry; UI still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!template.pdf_storage_path) {
      setPdfUrl(null);
      return;
    }
    fetch(`/api/settings/contract-templates/${template.id}/pdf`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setPdfUrl(j.url ?? null);
      })
      .catch(() => {
        if (!cancelled) setPdfUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [template.id, template.pdf_storage_path]);

  const persist = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSavingState("saving");
    const res = await fetch(`/api/settings/contract-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        description: template.description,
        signer_count: template.signer_count,
        signer_role_label: template.signer_role_label,
        overlay_fields: template.overlay_fields,
        version: template.version,
      }),
    });
    if (res.status === 409) {
      setSavingState("error");
      toast.error("Template was updated elsewhere — reloading.");
      const r = await fetch(`/api/settings/contract-templates/${template.id}`);
      const fresh = await r.json();
      setTemplate(fresh);
      return;
    }
    if (!res.ok) {
      setSavingState("error");
      const j = await res.json().catch(() => ({}));
      toast.error(
        j.error === "invalid_overlay_fields" ? "Some fields are invalid — check inspector" : "Save failed",
      );
      return;
    }
    const j = await res.json();
    setTemplate((prev) => ({ ...prev, version: j.version, updated_at: j.updated_at }));
    setSavingState("saved");
  }, [template]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!dirtyRef.current) return;
    debounceRef.current = setTimeout(() => {
      void persist();
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [template, persist]);

  function markDirty(updater: (prev: ContractTemplate) => ContractTemplate) {
    dirtyRef.current = true;
    setSavingState("idle");
    setTemplate(updater);
  }

  const onPageDrop = useCallback(
    (page: number, xPt: number, yPt: number, dt: DataTransfer) => {
      const type = dt.getData("application/x-overlay-field-type") as OverlayFieldType | "";
      if (!type) return;
      const sizes = DEFAULT_FIELD_SIZE[type];
      const meta = (template.pdf_pages ?? []).find((p) => p.page === page);
      if (!meta) return;
      const x = Math.max(0, Math.min(xPt - sizes.width / 2, meta.width_pt - sizes.width));
      const y = Math.max(0, Math.min(yPt - sizes.height / 2, meta.height_pt - sizes.height));
      const id = uuidv4();
      const newField: OverlayField = { id, type, page, x, y, ...sizes };
      if (type === "signature") newField.signerOrder = 1;
      if (type === "input" || type === "checkbox") {
        newField.inputKey = `${type}_${id.slice(0, 6)}`;
        newField.inputLabel = type === "checkbox" ? "I agree" : "Field";
      }
      if (type === "label") newField.labelText = "Label";
      // Default merge fields to the first known name so the validator passes on first drop.
      // Authors change it in the inspector.
      if (type === "merge") {
        newField.mergeFieldName =
          mergeRegistry.find((r) => !r.hidden)?.slug ?? "";
      }
      markDirty((prev) => ({ ...prev, overlay_fields: [...prev.overlay_fields, newField] }));
      setSelectedFieldId(id);
    },
    [template.pdf_pages, mergeRegistry],
  );

  const onMainPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if (!panEnabled) return;
      const el = mainRef.current;
      if (!el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = el.scrollLeft;
      const startScrollTop = el.scrollTop;
      let active = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!active && !isPanThresholdExceeded(dx, dy)) return;
        if (!active) {
          active = true;
          setPanning(true);
        }
        const target = mainRef.current;
        if (!target) return;
        target.scrollLeft = startScrollLeft - dx;
        target.scrollTop = startScrollTop - dy;
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (active) {
          setPanning(false);
          // The browser may fire a click after this pointerup; suppress one so
          // the parent's deselect handler doesn't run at the end of a pan-drag.
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [panEnabled],
  );

  useEffect(() => {
    if (!panning) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [panning]);

  function updateField(next: OverlayField) {
    markDirty((prev) => ({
      ...prev,
      overlay_fields: prev.overlay_fields.map((f) => (f.id === next.id ? next : f)),
    }));
  }

  function deleteField(id: string) {
    markDirty((prev) => ({
      ...prev,
      overlay_fields: prev.overlay_fields.filter((f) => f.id !== id),
    }));
    if (selectedFieldId === id) setSelectedFieldId(null);
  }

  async function replacePdf() {
    if (!confirm("Replacing the PDF will clear all overlay fields. Continue?")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("pdf", file);
      const res = await fetch(`/api/settings/contract-templates/${template.id}/pdf`, {
        method: "POST",
        body: form,
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error ?? "Upload failed");
        return;
      }
      setTemplate(j.template);
      setSelectedFieldId(null);
    };
    input.click();
  }

  if (!template.pdf_storage_path || !template.pdf_pages) {
    return (
      <TemplatePdfUploadZone
        templateId={template.id}
        onUploaded={(tpl) => setTemplate(tpl)}
      />
    );
  }

  if (!pdfUrl) {
    return <div className="p-12 text-muted-foreground">Loading PDF…</div>;
  }

  const selectedField = template.overlay_fields.find((f) => f.id === selectedFieldId) ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      <FieldPalette
        onReplacePdf={replacePdf}
        templateName={template.name}
        templateDescription={template.description}
        signerCount={template.signer_count}
        signerRoleLabel={template.signer_role_label}
        onMetaChange={(meta) => markDirty((prev) => ({ ...prev, ...meta }))}
      />
      <main
        ref={mainRef}
        className={`flex-1 overflow-auto bg-zinc-100 ${
          panEnabled ? (panning ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
        onPointerDown={onMainPointerDown}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setSelectedFieldId(null);
        }}
      >
        <div className="px-6 pt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {savingState === "saving" && "Saving…"}
            {savingState === "saved" && "Saved"}
            {savingState === "error" && "Save error"}
            {savingState === "idle" && "—"}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
                }}
                disabled={zoom <= ZOOM_MIN}
                className="rounded border border-border p-1 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
                }}
                disabled={zoom >= ZOOM_MAX}
                className="rounded border border-border p-1 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
              </button>
            </div>
            <a
              href={`/api/settings/contract-templates/${template.id}/preview`}
              target="_blank"
              rel="noopener"
              className="text-xs text-[var(--brand-primary)] hover:underline"
            >
              Preview ↗
            </a>
          </div>
        </div>
        <PdfCanvas
          pdfUrl={pdfUrl}
          pdfPages={template.pdf_pages}
          overlayFields={template.overlay_fields}
          zoom={zoom}
          onPageDrop={onPageDrop}
          renderOverlay={({ page, fields, scale }) => (
            <>
              {fields.map((f) => (
                <OverlayFieldChip
                  key={f.id}
                  field={f}
                  scale={scale}
                  selected={f.id === selectedFieldId}
                  onSelect={() => setSelectedFieldId(f.id)}
                  onChange={updateField}
                  pageWidthPt={page.width_pt}
                  pageHeightPt={page.height_pt}
                />
              ))}
            </>
          )}
        />
      </main>
      <FieldInspector
        field={selectedField}
        signerCount={template.signer_count}
        mergeRegistry={mergeRegistry}
        onChange={updateField}
        onDelete={() => selectedFieldId && deleteField(selectedFieldId)}
      />
    </div>
  );
}
