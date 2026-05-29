"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, Plus } from "lucide-react";
import { toast } from "sonner";
import TemplateBanner from "@/components/template-applicator/template-banner";
import type {
  AdjustmentType,
  BuilderEntity,
  Contact,
  Job,
} from "@/lib/types";
import type {
  EstimateWithContents,
  EstimateLineItem,
  InvoiceWithContents,
  TemplateWithContents,
} from "@/lib/types";
import { useAutoSave } from "./use-auto-save";
import { computeEstimateTotals, sumLineItemsFromSections } from "@/lib/estimates-calc";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  moveLineItemAcrossContainers,
  resolveLineItemDropTarget,
} from "./move-line-item";
import { HeaderBar } from "./header-bar";
import { TotalsPanel } from "./totals-panel";
import { MetadataBar } from "./metadata-bar";
import { CustomerBlock } from "./customer-block";
import { StatementEditor } from "./statement-editor";
import { SectionCard } from "./section-card";
import { AddItemDialog } from "./add-item-dialog";
import TemplateMetaBar from "./template-meta-bar";
import ConvertConfirmModal from "@/components/conversion/convert-confirm-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────────────────────
// Estimate-level root-PUT serializer (moved from use-auto-save.ts in Task 7)
// ─────────────────────────────────────────────────────────────────────────────

const ESTIMATE_FIELDS = [
  "title",
  "opening_statement",
  "closing_statement",
  "issued_date",
  "valid_until",
  "markup_type",
  "markup_value",
  "discount_type",
  "discount_value",
  "tax_rate",
  "status",
] as const;

type EstimateFieldKey = typeof ESTIMATE_FIELDS[number];
type EstimateFieldsSubset = Pick<EstimateWithContents, EstimateFieldKey>;

function pickEstimateFieldsForPut(estimate: EstimateWithContents): EstimateFieldsSubset {
  const result = {} as EstimateFieldsSubset;
  for (const k of ESTIMATE_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[k] = estimate[k];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice-level root-PUT serializer (Task 33.5 — used by Task 43 consumer page)
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_FIELDS = [
  "title",
  "opening_statement",
  "closing_statement",
  "issued_date",
  "due_date",
  "po_number",
  "markup_type",
  "markup_value",
  "discount_type",
  "discount_value",
  "tax_rate",
  "status",
] as const;

type InvoiceFieldKey = typeof INVOICE_FIELDS[number];
type InvoiceFieldsSubset = Pick<InvoiceWithContents, InvoiceFieldKey>;

function pickInvoiceFieldsForPut(invoice: InvoiceWithContents): InvoiceFieldsSubset {
  const result = {} as InvoiceFieldsSubset;
  for (const k of INVOICE_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[k] = invoice[k];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template-level root-PUT serializer (Task 33.5 — used by Task 40 consumer page)
// The whole template object is sent as `builder_state` so the server can
// snapshot it; promoted fields are sent flat for query-friendly columns.
// ─────────────────────────────────────────────────────────────────────────────

function serializeTemplateRootPut(template: TemplateWithContents) {
  return {
    name: template.name,
    description: template.description,
    damage_type_tags: template.damage_type_tags,
    opening_statement: template.opening_statement,
    closing_statement: template.closing_statement,
    builder_state: template,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Local recompute helpers — wrap computeEstimateTotals so invoice-mode setState
// branches can update sub/markup/discount/tax/total_amount in lockstep with the
// estimate-mode branches. The math is identical; only the output field name for
// "total" differs (estimate.total vs invoice.total_amount).
// ─────────────────────────────────────────────────────────────────────────────

function applyEstimateTotals<T extends {
  subtotal: number;
  markup_type: AdjustmentType;
  markup_value: number;
  discount_type: AdjustmentType;
  discount_value: number;
  tax_rate: number;
}>(estimate: T): T & ReturnType<typeof computeEstimateTotals> {
  const t = computeEstimateTotals(estimate);
  return { ...estimate, ...t };
}

function applyInvoiceTotals<T extends {
  subtotal: number;
  markup_type: AdjustmentType;
  markup_value: number;
  discount_type: AdjustmentType;
  discount_value: number;
  tax_rate: number;
}>(invoice: T): T & {
  markup_amount: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_amount: number;
  total_amount: number;
} {
  const { total, ...rest } = computeEstimateTotals(invoice);
  return { ...invoice, ...rest, total_amount: total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  entity: BuilderEntity;
}

export interface EstimateBuilderProps {
  entity: BuilderEntity;
  job?: (Job & { contact: Contact | null }) | null;
  defaultValidDays?: number;
  defaultDueDays?: number;
  defaultOpeningStatement?: string;
  defaultClosingStatement?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EstimateBuilder — central state container (client component)
// ─────────────────────────────────────────────────────────────────────────────

export function EstimateBuilder({
  entity,
  job,
  defaultValidDays = 30,
  defaultOpeningStatement = "",
  defaultClosingStatement = "",
}: EstimateBuilderProps) {
  const router = useRouter();
  const [state, setState] = useState<BuilderState>({ entity });
  // Re-sync local state when the server-rendered entity prop advances (e.g.
  // after router.refresh() following apply-template). Keyed on updated_at so
  // we don't clobber optimistic auto-save state on every parent re-render.
  useEffect(() => {
    setState({ entity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.data.id, (entity.data as { updated_at?: string }).updated_at]);

  // ── Task 33.5: auto-save config branches on entity.kind ───────────────────
  const autoSaveConfig =
    state.entity.kind === "estimate"
      ? {
          entityKind: "estimate" as const,
          entityId: state.entity.data.id,
          paths: {
            rootPut: `/api/estimates/${state.entity.data.id}`,
            sectionsReorder: `/api/estimates/${state.entity.data.id}/sections`,
            sectionRoute: (sid: string) =>
              `/api/estimates/${state.entity.data.id}/sections/${sid}`,
            lineItemsReorder: `/api/estimates/${state.entity.data.id}/line-items`,
            lineItemRoute: (iid: string) =>
              `/api/estimates/${state.entity.data.id}/line-items/${iid}`,
          },
          serializeRootPut: pickEstimateFieldsForPut,
          hasSnapshotConcurrency: true,
        }
      : state.entity.kind === "invoice"
      ? {
          entityKind: "invoice" as const,
          entityId: state.entity.data.id,
          paths: {
            rootPut: `/api/invoices/${state.entity.data.id}`,
            sectionsReorder: `/api/invoices/${state.entity.data.id}/sections`,
            sectionRoute: (sid: string) =>
              `/api/invoices/${state.entity.data.id}/sections/${sid}`,
            lineItemsReorder: `/api/invoices/${state.entity.data.id}/line-items`,
            lineItemRoute: (iid: string) =>
              `/api/invoices/${state.entity.data.id}/line-items/${iid}`,
          },
          serializeRootPut: pickInvoiceFieldsForPut,
          hasSnapshotConcurrency: true,
        }
      : {
          entityKind: "template" as const,
          entityId: state.entity.data.id,
          paths: {
            // Templates only persist via rootPut on debounce; the granular
            // section/line-item routes are never invoked (gated by entityKind).
            rootPut: `/api/estimate-templates/${state.entity.data.id}`,
            sectionsReorder: `/api/estimate-templates/${state.entity.data.id}`,
            sectionRoute: () =>
              `/api/estimate-templates/${state.entity.data.id}`,
            lineItemsReorder: `/api/estimate-templates/${state.entity.data.id}`,
            lineItemRoute: () =>
              `/api/estimate-templates/${state.entity.data.id}`,
          },
          serializeRootPut: serializeTemplateRootPut,
          hasSnapshotConcurrency: false,
        };

  // useAutoSave is generic over the entity type; each branch above passes a
  // type-correct config. We narrow on state.entity.kind to invoke the correct
  // hook instance — but React requires hooks called in stable order across
  // renders. Since the config switches per kind, we collapse via a single
  // call with type-erased config + state.
  const autoSaveState = {
    entity: state.entity.data,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEntity: (e: any) =>
      setState((prev) => ({
        ...prev,
        entity: { ...prev.entity, data: e } as BuilderEntity,
      })),
  };
  const { saveStatus, lastSavedAt, saveSectionsReorder, saveLineItemsReorder } =
    useAutoSave(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoSaveConfig as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoSaveState as any,
    );

  // Separate transient flag — not part of BuilderState because it's purely UI.
  const [isVoiding, setIsVoiding] = useState(false);

  // ── Task 26: AddItemDialog state ───────────────────────────────────────
  const [addItemTarget, setAddItemTarget] = useState<{ sectionId: string } | null>(null);

  // ── Slot 5: Add-section inline input state ─────────────────────────────
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  // ── Task 38: Convert modal state ───────────────────────────────────────
  const [convertOpen, setConvertOpen] = useState(false);
  const [alreadyConvertedTo, setAlreadyConvertedTo] = useState<
    { id: string; number: string } | null
  >(null);

  async function handleConvertConfirm() {
    if (state.entity.kind !== "estimate") return;
    const res = await fetch(
      `/api/estimates/${state.entity.data.id}/convert`,
      { method: "POST" },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        new_invoice_id: string;
        new_invoice_number: string;
      };
      router.push(`/invoices/${data.new_invoice_id}/edit`);
      return;
    }
    if (res.status === 409) {
      const err = (await res.json()) as {
        existing_invoice_id: string;
        existing_invoice_number: string;
      };
      setAlreadyConvertedTo({
        id: err.existing_invoice_id,
        number: err.existing_invoice_number,
      });
      return;
    }
    const err = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    toast.error(err.message || err.error || "Convert failed");
    setConvertOpen(false);
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────

  function onTitleChange(title: string) {
    setState((prev) => {
      // Templates store the user-facing title in `name`, not `title`.
      if (prev.entity.kind === "template") {
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, name: title },
          } as BuilderEntity,
        };
      }
      return {
        ...prev,
        entity: { ...prev.entity, data: { ...prev.entity.data, title } } as BuilderEntity,
      };
    });
    // Task 28 auto-save will pick this up.
  }

  // Task 40: template meta-bar patch handler — merges arbitrary template fields.
  function onTemplatePatch(patch: Partial<TemplateWithContents>) {
    setState((prev) => {
      if (prev.entity.kind !== "template") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: { ...prev.entity.data, ...patch },
        } as BuilderEntity,
      };
    });
  }

  function onIssuedDateChange(d: string | null) {
    setState((prev) => {
      // issued_date exists on estimate + invoice but not template.
      if (prev.entity.kind === "template") return prev; // TODO Task 40
      const next_data = { ...prev.entity.data, issued_date: d };
      // Auto-default valid_until is estimate-only.
      if (prev.entity.kind === "estimate" && d && prev.entity.data.valid_until === null) {
        const [y, m, day] = d.split("-").map(Number);
        const issued = new Date(Date.UTC(y, m - 1, day));
        issued.setUTCDate(issued.getUTCDate() + defaultValidDays);
        const yyyy = issued.getUTCFullYear();
        const mm = String(issued.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(issued.getUTCDate()).padStart(2, "0");
        (next_data as EstimateWithContents).valid_until = `${yyyy}-${mm}-${dd}`;
      }
      return {
        ...prev,
        entity: { ...prev.entity, data: next_data } as BuilderEntity,
      };
    });
    // Task 28 auto-save will pick this up.
  }

  function onValidUntilChange(d: string | null) {
    setState((prev) => {
      if (prev.entity.kind !== "estimate") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: { ...prev.entity.data, valid_until: d },
        },
      };
    });
    // Task 28 auto-save will pick this up.
  }

  // Task 43: invoice-only — Due date.
  function onDueDateChange(d: string | null) {
    setState((prev) => {
      if (prev.entity.kind !== "invoice") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: { ...prev.entity.data, due_date: d },
        },
      };
    });
    // Auto-save picks this up via root PUT.
  }

  // Task 43: invoice-only — PO number.
  function onPoNumberChange(po: string | null) {
    setState((prev) => {
      if (prev.entity.kind !== "invoice") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: { ...prev.entity.data, po_number: po },
        },
      };
    });
    // Auto-save picks this up via root PUT.
  }

  function onOpeningStatementChange(next: string | null) {
    setState((prev) => ({
      ...prev,
      entity: {
        ...prev.entity,
        data: { ...prev.entity.data, opening_statement: next },
      } as BuilderEntity,
    }));
    // Task 28 auto-save will pick this up.
  }

  function onClosingStatementChange(next: string | null) {
    setState((prev) => ({
      ...prev,
      entity: {
        ...prev.entity,
        data: { ...prev.entity.data, closing_statement: next },
      } as BuilderEntity,
    }));
    // Task 28 auto-save will pick this up.
  }

  async function onVoid(reason: string) {
    if (isVoiding) return;
    if (state.entity.kind === "template") return; // templates have no void flow
    setIsVoiding(true);
    try {
      const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
      const url = `/api/${entityBase}/${state.entity.data.id}?reason=${encodeURIComponent(reason)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          body.error ||
            (state.entity.kind === "invoice" ? "Failed to void invoice" : "Failed to void estimate"),
        );
        return;
      }
      // Optimistic update — voided_at uses client clock; server's value is canonical
      // and will be reconciled on the next read. Display-only divergence today.
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: {
              ...prev.entity.data,
              status: "voided",
              void_reason: reason,
              voided_at: new Date().toISOString(),
            },
          } as BuilderEntity,
        };
      });
      toast.success(
        state.entity.kind === "invoice" ? "Invoice voided" : "Estimate voided",
      );
    } finally {
      setIsVoiding(false);
    }
  }

  const isVoided =
    state.entity.kind !== "template" && state.entity.data.status === "voided";

  // ── Task 27: markup / discount / tax callbacks ─────────────────────────
  // Estimate: live local recompute via computeEstimateTotals. Invoice: optimistic
  // local field update only; the server's recalculateInvoiceTotals on the next
  // root PUT settles the panel values (TotalsPanel may briefly show stale totals).

  function onMarkupChange(type: AdjustmentType, value: number) {
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        const next_estimate = applyEstimateTotals({
          ...prev.entity.data,
          markup_type: type,
          markup_value: value,
        });
        return { ...prev, entity: { ...prev.entity, data: next_estimate } };
      }
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          markup_type: type,
          markup_value: value,
        });
        return { ...prev, entity: { ...prev.entity, data: next_invoice } };
      }
      return prev;
    });
  }

  function onDiscountChange(type: AdjustmentType, value: number) {
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        const next_estimate = applyEstimateTotals({
          ...prev.entity.data,
          discount_type: type,
          discount_value: value,
        });
        return { ...prev, entity: { ...prev.entity, data: next_estimate } };
      }
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          discount_type: type,
          discount_value: value,
        });
        return { ...prev, entity: { ...prev.entity, data: next_invoice } };
      }
      return prev;
    });
  }

  function onTaxRateChange(rate: number) {
    const clamped = Math.max(0, Math.min(100, rate));
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        const next_estimate = applyEstimateTotals({
          ...prev.entity.data,
          tax_rate: clamped,
        });
        return { ...prev, entity: { ...prev.entity, data: next_estimate } };
      }
      if (prev.entity.kind === "invoice") {
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          tax_rate: clamped,
        });
        return { ...prev, entity: { ...prev.entity, data: next_invoice } };
      }
      return prev;
    });
  }

  // ── Slot 5: dnd-kit sensors ────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Slot 5: section CRUD ───────────────────────────────────────────────

  async function onAddSection(title: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      const nextOrder = state.entity.data.sections.length;
      const newSection = {
        id: crypto.randomUUID(),
        title,
        sort_order: nextOrder,
        parent_section_id: null,
        items: [],
        subsections: [],
      };
      setState((prev) => ({
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: [...prev.entity.data.sections, newSection],
          },
        } as BuilderEntity,
      }));
      setShowAddSection(false);
      setNewSectionTitle("");
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    try {
      const res = await fetch(`/api/${entityBase}/${entityId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parent_section_id: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to add section");
        return;
      }
      const { section } = (await res.json()) as {
        section: EstimateWithContents["sections"][number];
      };
      const newSection = { ...section, items: [], subsections: [] };
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: {
              ...prev.entity.data,
              sections: [...prev.entity.data.sections, newSection],
            },
          } as BuilderEntity,
        };
      });
      setShowAddSection(false);
      setNewSectionTitle("");
    } catch {
      toast.error("Network error — could not add section");
    }
  }

  async function onSectionRename(id: string, title: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => ({
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: (prev.entity.data as TemplateWithContents).sections.map((s) =>
              s.id === id ? { ...s, title } : s
            ),
          },
        } as BuilderEntity,
      }));
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    // Optimistic local update
    setState((prev) => {
      if (prev.entity.kind === "template") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: prev.entity.data.sections.map((s) =>
              s.id === id ? { ...s, title } : s
            ),
          },
        } as BuilderEntity,
      };
    });
    try {
      const res = await fetch(
        `/api/${entityBase}/${entityId}/sections/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to rename section");
      }
    } catch {
      toast.error("Network error — could not rename section");
    }
  }

  async function onSectionDelete(id: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => ({
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: (prev.entity.data as TemplateWithContents).sections.filter(
              (s) => s.id !== id,
            ),
          },
        } as BuilderEntity,
      }));
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    const snapshot = state.entity.data; // capture before mutation
    setState((prev) => {
      if (prev.entity.kind === "template") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: prev.entity.data.sections.filter((s) => s.id !== id),
          },
        } as BuilderEntity,
      };
    });
    try {
      const res = await fetch(
        `/api/${entityBase}/${entityId}/sections/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete section");
        setState((prev) => {
          if (prev.entity.kind === "template") return prev;
          return {
            ...prev,
            entity: { ...prev.entity, data: snapshot } as BuilderEntity,
          };
        });
      } else {
        toast.success("Section deleted");
      }
    } catch {
      toast.error("Network error — could not delete section");
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: { ...prev.entity, data: snapshot } as BuilderEntity,
        };
      });
    }
  }

  // ── Slot 5: subsection CRUD ────────────────────────────────────────────

  async function onSubsectionAdd(parentId: string, title: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => {
        if (prev.entity.kind !== "template") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: {
              ...prev.entity.data,
              sections: prev.entity.data.sections.map((s) => {
                if (s.id !== parentId) return s;
                const nextOrder = s.subsections.length;
                const newSub = {
                  id: crypto.randomUUID(),
                  title,
                  sort_order: nextOrder,
                  items: [],
                };
                return { ...s, subsections: [...s.subsections, newSub] };
              }),
            },
          } as BuilderEntity,
        };
      });
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    try {
      const res = await fetch(`/api/${entityBase}/${entityId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parent_section_id: parentId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to add subsection");
        return;
      }
      const { section } = (await res.json()) as {
        section: import("@/lib/types").EstimateSection;
      };
      const newSub = { ...section, items: [] };
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: {
              ...prev.entity.data,
              sections: prev.entity.data.sections.map((s) =>
                s.id === parentId
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ? { ...s, subsections: [...s.subsections, newSub as any] }
                  : s
              ),
            },
          } as BuilderEntity,
        };
      });
    } catch {
      toast.error("Network error — could not add subsection");
    }
  }

  async function onSubsectionRename(id: string, title: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => ({
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: (prev.entity.data as TemplateWithContents).sections.map((s) => ({
              ...s,
              subsections: s.subsections.map((sub) =>
                sub.id === id ? { ...sub, title } : sub
              ),
            })),
          },
        } as BuilderEntity,
      }));
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    // Optimistic update
    setState((prev) => {
      if (prev.entity.kind === "template") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: prev.entity.data.sections.map((s) => ({
              ...s,
              subsections: s.subsections.map((sub) =>
                sub.id === id ? { ...sub, title } : sub
              ),
            })),
          },
        } as BuilderEntity,
      };
    });
    try {
      const res = await fetch(
        `/api/${entityBase}/${entityId}/sections/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to rename subsection");
      }
    } catch {
      toast.error("Network error — could not rename subsection");
    }
  }

  async function onSubsectionDelete(id: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => ({
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: (prev.entity.data as TemplateWithContents).sections.map((s) => ({
              ...s,
              subsections: s.subsections.filter((sub) => sub.id !== id),
            })),
          },
        } as BuilderEntity,
      }));
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    const snapshot = state.entity.data; // capture before mutation
    setState((prev) => {
      if (prev.entity.kind === "template") return prev;
      return {
        ...prev,
        entity: {
          ...prev.entity,
          data: {
            ...prev.entity.data,
            sections: prev.entity.data.sections.map((s) => ({
              ...s,
              subsections: s.subsections.filter((sub) => sub.id !== id),
            })),
          },
        } as BuilderEntity,
      };
    });
    try {
      const res = await fetch(
        `/api/${entityBase}/${entityId}/sections/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete subsection");
        setState((prev) => {
          if (prev.entity.kind === "template") return prev;
          return {
            ...prev,
            entity: { ...prev.entity, data: snapshot } as BuilderEntity,
          };
        });
      } else {
        toast.success("Subsection deleted");
      }
    } catch {
      toast.error("Network error — could not delete subsection");
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: { ...prev.entity, data: snapshot } as BuilderEntity,
        };
      });
    }
  }

  // ── Slot 5: line-item delete ───────────────────────────────────────────

  async function onLineItemDelete(id: string) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => {
        if (prev.entity.kind !== "template") return prev;
        const sections_after = prev.entity.data.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        }));
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      });
      return;
    }
    // Estimate or invoice: HTTP path with entityBase substituted.
    const entityBase = state.entity.kind === "invoice" ? "invoices" : "estimates";
    const entityId = state.entity.data.id;
    const snapshot = state.entity.data; // capture before mutation
    // Remove from local state (works for items in sections OR subsections).
    // Task 43 fix: previously early-returned for non-estimate, dropping the
    // optimistic update for invoice mode.
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        const sections_after = prev.entity.data.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_estimate = { ...prev.entity.data, sections: sections_after, subtotal };
        const totals = computeEstimateTotals(next_estimate);
        return {
          ...prev,
          entity: { ...prev.entity, data: { ...next_estimate, ...totals } },
        };
      }
      if (prev.entity.kind === "invoice") {
        // Invoice mode: optimistic local removal + local totals recompute so
        // TotalsPanel updates instantly. Server reconciles authoritative values
        // via recalculateInvoiceTotals on the DELETE route + next root PUT.
        const sections_after = prev.entity.data.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
      return prev;
    });
    try {
      const res = await fetch(
        `/api/${entityBase}/${entityId}/line-items/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete line item");
        setState((prev) => {
          if (prev.entity.kind === "template") return prev;
          return {
            ...prev,
            entity: { ...prev.entity, data: snapshot } as BuilderEntity,
          };
        });
      } else {
        toast.success("Line item deleted");
      }
    } catch {
      toast.error("Network error — could not delete line item");
      setState((prev) => {
        if (prev.entity.kind === "template") return prev;
        return {
          ...prev,
          entity: { ...prev.entity, data: snapshot } as BuilderEntity,
        };
      });
    }
  }

  // ── Slot 5: line-item inline edit (Task 25) ───────────────────────────

  function onLineItemChange(
    itemId: string,
    partial: Partial<EstimateLineItem | import("@/lib/types").InvoiceLineItem>,
  ) {
    // Template mode: local synthesis; rootPut auto-save persists.
    if (state.entity.kind === "template") {
      setState((prev) => {
        if (prev.entity.kind !== "template") return prev;
        const sections_after = prev.entity.data.sections.map((sec) => ({
          ...sec,
          items: sec.items.map((item) =>
            item.id === itemId ? { ...item, ...partial } : item
          ),
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            items: sub.items.map((item) =>
              item.id === itemId ? { ...item, ...partial } : item
            ),
          })),
        }));
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      });
      return;
    }
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        // Narrow the widened partial to estimate shape inside the estimate branch.
        const estimatePartial = partial as Partial<EstimateLineItem>;
        const sections_after = prev.entity.data.sections.map((sec) => ({
          ...sec,
          items: sec.items.map((item) =>
            item.id === itemId ? { ...item, ...estimatePartial } : item
          ),
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            items: sub.items.map((item) =>
              item.id === itemId ? { ...item, ...estimatePartial } : item
            ),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_estimate = applyEstimateTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_estimate },
        };
      }
      if (prev.entity.kind === "invoice") {
        // Cast partial to invoice-shaped Partial inside the invoice narrowing —
        // the editable subset (description, code, quantity, unit, unit_price)
        // is name-compatible across both kinds. Recompute totals locally so
        // TotalsPanel updates instantly; server reconciles via the line-item
        // PUT's recalculateInvoiceTotals.
        const invoicePartial = partial as Partial<import("@/lib/types").InvoiceLineItem>;
        const sections_after = prev.entity.data.sections.map((sec) => ({
          ...sec,
          items: sec.items.map((item) =>
            item.id === itemId ? { ...item, ...invoicePartial } : item
          ),
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            items: sub.items.map((item) =>
              item.id === itemId ? { ...item, ...invoicePartial } : item
            ),
          })),
        }));
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
      return prev;
    });
    // Task 28 auto-save will pick this up.
  }

  function onAddLineItem(sectionId: string) {
    setAddItemTarget({ sectionId });
  }

  function onLineItemAdded(
    newItem: EstimateLineItem | import("@/lib/types").InvoiceLineItem,
  ) {
    // Template mode: AddItemDialog passes a synthesized item (per Task 32);
    // insert it into local state. rootPut auto-save handles persistence.
    if (state.entity.kind === "template") {
      setState((prev) => {
        if (prev.entity.kind !== "template") return prev;
        const sections_after = prev.entity.data.sections.map((sec) => {
          if (sec.id === newItem.section_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { ...sec, items: [...sec.items, newItem as any] };
          }
          return {
            ...sec,
            subsections: sec.subsections.map((sub) =>
              sub.id === newItem.section_id
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? { ...sub, items: [...sub.items, newItem as any] }
                : sub
            ),
          };
        });
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: sections_after },
          } as BuilderEntity,
        };
      });
      return;
    }
    setState((prev) => {
      if (prev.entity.kind === "estimate") {
        // Narrow the widened newItem to estimate shape inside the estimate branch.
        const estimateItem = newItem as EstimateLineItem;
        const sections_after = prev.entity.data.sections.map((sec) => {
          if (sec.id === estimateItem.section_id) {
            return { ...sec, items: [...sec.items, estimateItem] };
          }
          return {
            ...sec,
            subsections: sec.subsections.map((sub) =>
              sub.id === estimateItem.section_id
                ? { ...sub, items: [...sub.items, estimateItem] }
                : sub
            ),
          };
        });
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_estimate = applyEstimateTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_estimate },
        };
      }
      if (prev.entity.kind === "invoice") {
        // POST returns InvoiceLineItem (now wrapped via Task 1's C1 fix); cast
        // inside the invoice narrowing. Recompute totals locally so TotalsPanel
        // updates instantly; server reconciles via the POST's recalculateInvoiceTotals.
        const invoiceItem = newItem as import("@/lib/types").InvoiceLineItem;
        const sections_after = prev.entity.data.sections.map((sec) => {
          if (sec.id === invoiceItem.section_id) {
            return { ...sec, items: [...sec.items, invoiceItem] };
          }
          return {
            ...sec,
            subsections: sec.subsections.map((sub) =>
              sub.id === invoiceItem.section_id
                ? { ...sub, items: [...sub.items, invoiceItem] }
                : sub
            ),
          };
        });
        const subtotal = sumLineItemsFromSections(sections_after);
        const next_invoice = applyInvoiceTotals({
          ...prev.entity.data,
          sections: sections_after,
          subtotal,
        });
        return {
          ...prev,
          entity: { ...prev.entity, data: next_invoice },
        };
      }
      return prev;
    });
  }

  // ── Slot 5 / Task 28: drag-end handler ────────────────────────────────────
  // Drag-reorder updates local state optimistically, then fires the appropriate
  // PUT immediately (not debounced). On failure, the local state is rolled back.

  function handleDragEnd(event: DragEndEvent) {
    // Template mode: local-only reorder; rootPut auto-save persists via
    // builder_state. No HTTP per-section/per-item.
    if (state.entity.kind === "template") {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeType = active.data.current?.type as string | undefined;

      if (activeType === "section") {
        const secs = state.entity.data.sections;
        const oldIdx = secs.findIndex((s) => s.id === active.id);
        const newIdx = secs.findIndex((s) => s.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
        const reorderedSections = arrayMove(secs, oldIdx, newIdx);
        setState((prev) => {
          if (prev.entity.kind !== "template") return prev;
          return {
            ...prev,
            entity: { ...prev.entity, data: { ...prev.entity.data, sections: reorderedSections } } as BuilderEntity,
          };
        });
        return;
      }

      if (activeType === "subsection") {
        const activeParent = active.data.current?.parentSectionId as string | undefined;
        const overParent = over.data.current?.parentSectionId as string | undefined;
        if (activeParent !== overParent) return;
        const parent = state.entity.data.sections.find((s) => s.id === activeParent);
        if (!parent) return;
        const oldIdx = parent.subsections.findIndex((sub) => sub.id === active.id);
        const newIdx = parent.subsections.findIndex((sub) => sub.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
        const reorderedSections = state.entity.data.sections.map((s) =>
          s.id !== activeParent ? s : { ...s, subsections: arrayMove(s.subsections, oldIdx, newIdx) },
        );
        setState((prev) => {
          if (prev.entity.kind !== "template") return prev;
          return {
            ...prev,
            entity: { ...prev.entity, data: { ...prev.entity.data, sections: reorderedSections } } as BuilderEntity,
          };
        });
        return;
      }

      if (activeType === "line-item") {
        // Cross-container Line item drag (#264). Helpers handle same-container
        // reorder, the four cross-container shapes, drop-on-self, and invalid
        // input. The existing debounced rootPut of builder_state persists the
        // resulting tree — no per-item HTTP path.
        const dest = resolveLineItemDropTarget(over);
        if (!dest) return;
        const result = moveLineItemAcrossContainers(
          state.entity.data.sections,
          String(active.id),
          dest.destinationContainerId,
          dest.overItemId ?? null,
        );
        if (!result) return;
        setState((prev) => {
          if (prev.entity.kind !== "template") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: result.sections },
            } as BuilderEntity,
          };
        });
      }
      return;
    }

    if (state.entity.kind === "invoice") {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeType = active.data.current?.type as string | undefined;

      if (activeType === "section") {
        const secs = state.entity.data.sections;
        const oldIdx = secs.findIndex((s) => s.id === active.id);
        const newIdx = secs.findIndex((s) => s.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reorderedSections = arrayMove(secs, oldIdx, newIdx);
        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: reorderedSections },
            },
          };
        });

        const sectionPayload = reorderedSections.flatMap((sec, idx) => [
          { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
          ...sec.subsections.map((sub, subIdx) => ({
            id: sub.id,
            sort_order: subIdx,
            parent_section_id: sec.id,
          })),
        ]);

        void saveSectionsReorder(sectionPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save section order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
        return;
      }

      if (activeType === "subsection") {
        const activeParent = active.data.current?.parentSectionId as string | undefined;
        const overParent = over.data.current?.parentSectionId as string | undefined;
        if (activeParent !== overParent) return;

        const parentSection = state.entity.data.sections.find((s) => s.id === activeParent);
        if (!parentSection) return;
        const subs = parentSection.subsections;
        const oldIdx = subs.findIndex((sub) => sub.id === active.id);
        const newIdx = subs.findIndex((sub) => sub.id === over.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reorderedSections = state.entity.data.sections.map((s) => {
          if (s.id !== activeParent) return s;
          return { ...s, subsections: arrayMove(subs, oldIdx, newIdx) };
        });
        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: reorderedSections },
            },
          };
        });

        const sectionPayload = reorderedSections.flatMap((sec, idx) => [
          { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
          ...sec.subsections.map((sub, subIdx) => ({
            id: sub.id,
            sort_order: subIdx,
            parent_section_id: sec.id,
          })),
        ]);

        void saveSectionsReorder(sectionPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save subsection order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
        return;
      }

      if (activeType === "line-item") {
        // Cross-container Line item drag (#267). Helpers from #264 handle the
        // four cross-container shapes, same-container reorder, drop-on-self,
        // and invalid input. The invoice line-items reorder route (with the
        // body.items field fix from #265) updates section_id + sort_order
        // per item, so the payload covers every item in BOTH the source and
        // destination containers.
        const dest = resolveLineItemDropTarget(over);
        if (!dest) return;
        const result = moveLineItemAcrossContainers(
          state.entity.data.sections,
          String(active.id),
          dest.destinationContainerId,
          dest.overItemId ?? null,
        );
        if (!result) return;

        const snapshot = state.entity.data;

        setState((prev) => {
          if (prev.entity.kind !== "invoice") return prev;
          return {
            ...prev,
            entity: {
              ...prev.entity,
              data: { ...prev.entity.data, sections: result.sections },
            },
          };
        });

        // InvoiceLineItem.section_id is `string | null` in the type system
        // (unlike EstimateLineItem's `string`), though the builder UI never
        // produces orphan items. Preserve the defensive filter — affected
        // items returned by the helper always carry a string section_id
        // (the helper sets section_id = destinationContainerId), so this
        // filter is a no-op in practice but keeps the type narrowing tight.
        const itemPayload = result.affectedItems
          .filter((it): it is typeof it & { section_id: string } => it.section_id !== null)
          .map((it) => ({
            id: it.id,
            section_id: it.section_id,
            sort_order: it.sort_order,
          }));

        void saveLineItemsReorder(itemPayload).then((ok) => {
          if (!ok) {
            toast.error("Failed to save line item order");
            setState((prev) => {
              if (prev.entity.kind !== "invoice") return prev;
              return { ...prev, entity: { ...prev.entity, data: snapshot } };
            });
          }
        });
      }
      return;
    }

    if (state.entity.kind !== "estimate") return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as string | undefined;

    if (activeType === "section") {
      const secs = state.entity.data.sections;
      const oldIdx = secs.findIndex((s) => s.id === active.id);
      const newIdx = secs.findIndex((s) => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

      const reorderedSections = arrayMove(secs, oldIdx, newIdx);
      const snapshot = state.entity.data; // capture before setState

      setState((prev) => {
        if (prev.entity.kind !== "estimate") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: reorderedSections },
          },
        };
      });

      // Build the flat list including subsections with updated sort_order
      const sectionPayload = reorderedSections.flatMap((sec, idx) => [
        { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
        ...sec.subsections.map((sub, subIdx) => ({
          id: sub.id,
          sort_order: subIdx,
          parent_section_id: sec.id,
        })),
      ]);

      void saveSectionsReorder(sectionPayload).then((ok) => {
        if (!ok) {
          toast.error("Failed to save section order");
          setState((prev) => {
            if (prev.entity.kind !== "estimate") return prev;
            return { ...prev, entity: { ...prev.entity, data: snapshot } };
          });
        }
      });
      return;
    }

    if (activeType === "subsection") {
      // Cross-section drags: snap back — only allow within the same parent section.
      const activeParent = active.data.current?.parentSectionId as string | undefined;
      const overParent = over.data.current?.parentSectionId as string | undefined;
      if (activeParent !== overParent) return; // snap back

      // Compute outside setState — synchronous event handler, state is current.
      const parentSection = state.entity.data.sections.find((s) => s.id === activeParent);
      if (!parentSection) return;
      const subs = parentSection.subsections;
      const oldIdx = subs.findIndex((sub) => sub.id === active.id);
      const newIdx = subs.findIndex((sub) => sub.id === over.id);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

      const reorderedSections = state.entity.data.sections.map((s) => {
        if (s.id !== activeParent) return s;
        return { ...s, subsections: arrayMove(subs, oldIdx, newIdx) };
      });
      const snapshot = state.entity.data; // capture before setState

      setState((prev) => {
        if (prev.entity.kind !== "estimate") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: reorderedSections },
          },
        };
      });

      const sectionPayload = reorderedSections.flatMap((sec, idx) => [
        { id: sec.id, sort_order: idx, parent_section_id: null as string | null },
        ...sec.subsections.map((sub, subIdx) => ({
          id: sub.id,
          sort_order: subIdx,
          parent_section_id: sec.id,
        })),
      ]);

      void saveSectionsReorder(sectionPayload).then((ok) => {
        if (!ok) {
          toast.error("Failed to save subsection order");
          setState((prev) => {
            if (prev.entity.kind !== "estimate") return prev;
            return { ...prev, entity: { ...prev.entity, data: snapshot } };
          });
        }
      });
      return;
    }

    if (activeType === "line-item") {
      // Cross-container Line item drag (#266). Helpers from #264 handle the
      // four cross-container shapes, same-container reorder, drop-on-self, and
      // invalid input. The estimate line-items reorder route already supports
      // cross-container moves (validates each section_id belongs to this
      // estimate, then updates section_id + sort_order per item), so the
      // payload covers every item in BOTH the source and destination
      // containers.
      const dest = resolveLineItemDropTarget(over);
      if (!dest) return;
      const result = moveLineItemAcrossContainers(
        state.entity.data.sections,
        String(active.id),
        dest.destinationContainerId,
        dest.overItemId ?? null,
      );
      if (!result) return;

      const snapshot = state.entity.data;

      setState((prev) => {
        if (prev.entity.kind !== "estimate") return prev;
        return {
          ...prev,
          entity: {
            ...prev.entity,
            data: { ...prev.entity.data, sections: result.sections },
          },
        };
      });

      const itemPayload = result.affectedItems.map((it) => ({
        id: it.id,
        section_id: it.section_id,
        sort_order: it.sort_order,
      }));

      void saveLineItemsReorder(itemPayload).then((ok) => {
        if (!ok) {
          toast.error("Failed to save line item order");
          setState((prev) => {
            if (prev.entity.kind !== "estimate") return prev;
            return { ...prev, entity: { ...prev.entity, data: snapshot } };
          });
        }
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // All three modes (estimate / invoice / template) now have real JSX branches.

  if (state.entity.kind === "invoice") {
    // ── Invoice-mode JSX (Task 43) ─────────────────────────────────────────
    // Mirrors estimate-mode shape but strips: TemplateBanner,
    // ConvertConfirmModal, Convert button (HeaderBar handles per-kind action
    // buttons — Mark as Sent / Mark as Paid / Send Payment Request / Void).
    const invoiceEntity = state.entity; // narrowed
    const invoice = invoiceEntity.data;
    const invSections = invoice.sections;
    const invMode = invoiceEntity.kind;

    return (
      <div className="relative min-h-screen bg-background">
        {/* Voided banner */}
        {isVoided && (
          <div className="w-full bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2 text-sm text-destructive font-medium">
            <AlertOctagon size={16} />
            This invoice has been voided
            {invoice.void_reason && (
              <span className="font-normal text-destructive/80">
                — {invoice.void_reason}
              </span>
            )}
          </div>
        )}

        <main className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-4">
          {/* ── HeaderBar — Mark as Sent / Mark as Paid / Send Payment / Void ── */}
          <HeaderBar
            entity={invoiceEntity}
            onTitleChange={onTitleChange}
            onVoid={onVoid}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            isVoiding={isVoiding}
          />

          {/* ── MetadataBar — Issued + Due + PO + converted-from-link ── */}
          <MetadataBar
            entity={invoice}
            onIssuedDateChange={onIssuedDateChange}
            onValidUntilChange={onValidUntilChange}
            onDueDateChange={onDueDateChange}
            onPoNumberChange={onPoNumberChange}
            mode={invMode}
          />

          {/* ── CustomerBlock ── */}
          {job && <CustomerBlock job={job} mode={invMode} />}

          {/* ── Opening statement ── */}
          <StatementEditor
            label="Opening statement"
            value={invoice.opening_statement}
            onChange={onOpeningStatementChange}
            defaultText={defaultOpeningStatement}
            readOnly={isVoided}
            mode={invMode}
          />

          {/* ── Sections list ── */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {invSections.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border bg-card p-12 flex flex-col items-center gap-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Add a section to get started
                </p>
                <Button
                  onClick={() => setShowAddSection(true)}
                  size="sm"
                  className="gap-1.5"
                  disabled={isVoided}
                >
                  <Plus size={14} />
                  New Section
                </Button>
              </div>
            ) : (
              <SortableContext
                items={invSections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-3">
                  {invSections.map((sec, sIdx) => (
                    <SectionCard
                      key={sec.id}
                      section={sec}
                      onRename={onSectionRename}
                      onDelete={onSectionDelete}
                      onAddSubsection={onSubsectionAdd}
                      onAddLineItem={onAddLineItem}
                      onLineItemDelete={onLineItemDelete}
                      onLineItemChange={onLineItemChange}
                      onSubsectionRename={onSubsectionRename}
                      onSubsectionDelete={onSubsectionDelete}
                      onSubsectionLineItemDelete={onLineItemDelete}
                      readOnly={isVoided}
                      mode={invMode}
                      sectionIdx={sIdx}
                    />
                  ))}
                </ul>
              </SortableContext>
            )}

            {/* Add Section inline input */}
            <div className="mt-3 pt-3 border-t border-border">
              {showAddSection ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={newSectionTitle}
                    maxLength={200}
                    placeholder="Section name"
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSectionTitle.trim()) {
                        void onAddSection(newSectionTitle.trim());
                      }
                      if (e.key === "Escape") {
                        setShowAddSection(false);
                        setNewSectionTitle("");
                      }
                    }}
                    className="h-8 text-sm flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newSectionTitle.trim()) {
                        void onAddSection(newSectionTitle.trim());
                      }
                    }}
                    disabled={!newSectionTitle.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddSection(false);
                      setNewSectionTitle("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSection(true)}
                  disabled={isVoided}
                  className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={13} />
                  Add Section
                </button>
              )}
            </div>
          </DndContext>

          {/* ── Closing statement ── */}
          <StatementEditor
            label="Closing statement"
            value={invoice.closing_statement}
            onChange={onClosingStatementChange}
            defaultText={defaultClosingStatement}
            readOnly={isVoided}
            mode={invMode}
          />
        </main>

        {/* ── TotalsPanel (sticky bottom-right) ─────────────────────────── */}
        <TotalsPanel
          entity={invoiceEntity}
          onMarkupChange={onMarkupChange}
          onDiscountChange={onDiscountChange}
          onTaxRateChange={onTaxRateChange}
          readOnly={isVoided}
          mode={invMode}
        />

        {/* ── AddItemDialog ─────────────────────────────────────────────── */}
        <AddItemDialog
          open={addItemTarget !== null}
          onOpenChange={(open) => !open && setAddItemTarget(null)}
          estimateId={invoice.id}
          sectionId={addItemTarget?.sectionId ?? ""}
          jobDamageType={job?.damage_type}
          onAdded={onLineItemAdded}
          mode={invMode}
        />
      </div>
    );
  }

  if (state.entity.kind === "template") {
    // ── Template-mode JSX (Task 40) ────────────────────────────────────────
    // Mirrors estimate-mode shape but strips: MetadataBar (replaced by
    // TemplateMetaBar), CustomerBlock, TotalsPanel, TemplateBanner,
    // voided banner, Convert modal.
    const templateEntity = state.entity; // narrowed
    const template = templateEntity.data;
    const tmplSections = template.sections;
    const tmplMode = templateEntity.kind;

    return (
      <div className="relative min-h-screen bg-background">
        <main className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-4">
          {/* ── HeaderBar — Save Template / Cancel-edit per spec §4.1 ── */}
          <HeaderBar
            entity={templateEntity}
            onTitleChange={onTitleChange}
            onVoid={() => {
              /* templates have no void flow */
            }}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            isVoiding={false}
          />

          {/* ── TemplateMetaBar — name, description, damage_type_tags ── */}
          <TemplateMetaBar template={template} onChange={onTemplatePatch} />

          {/* ── Opening statement ── */}
          <StatementEditor
            label="Opening statement"
            value={template.opening_statement}
            onChange={onOpeningStatementChange}
            defaultText=""
            mode={tmplMode}
          />

          {/* ── Sections list ── */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {tmplSections.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border bg-card p-12 flex flex-col items-center gap-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Add a section to get started
                </p>
                <Button
                  onClick={() => setShowAddSection(true)}
                  size="sm"
                  className="gap-1.5"
                >
                  <Plus size={14} />
                  New Section
                </Button>
              </div>
            ) : (
              <SortableContext
                items={tmplSections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-3">
                  {tmplSections.map((sec, sIdx) => (
                    <SectionCard
                      key={sec.id}
                      // Template sections have a structurally compatible
                      // shape but lack the EstimateSection scalar fields
                      // (organization_id, estimate_id, created_at,
                      // updated_at). Cast through unknown — SectionCard
                      // only reads id/title/sort_order/items/subsections.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      section={sec as any}
                      onRename={onSectionRename}
                      onDelete={onSectionDelete}
                      onAddSubsection={onSubsectionAdd}
                      onAddLineItem={onAddLineItem}
                      onLineItemDelete={onLineItemDelete}
                      onLineItemChange={onLineItemChange}
                      onSubsectionRename={onSubsectionRename}
                      onSubsectionDelete={onSubsectionDelete}
                      onSubsectionLineItemDelete={onLineItemDelete}
                      mode={tmplMode}
                      sectionIdx={sIdx}
                    />
                  ))}
                </ul>
              </SortableContext>
            )}

            {/* Add Section inline input */}
            <div className="mt-3 pt-3 border-t border-border">
              {showAddSection ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={newSectionTitle}
                    maxLength={200}
                    placeholder="Section name"
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSectionTitle.trim()) {
                        void onAddSection(newSectionTitle.trim());
                      }
                      if (e.key === "Escape") {
                        setShowAddSection(false);
                        setNewSectionTitle("");
                      }
                    }}
                    className="h-8 text-sm flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newSectionTitle.trim()) {
                        void onAddSection(newSectionTitle.trim());
                      }
                    }}
                    disabled={!newSectionTitle.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddSection(false);
                      setNewSectionTitle("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSection(true)}
                  className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
                >
                  <Plus size={13} />
                  Add Section
                </button>
              )}
            </div>
          </DndContext>

          {/* ── Closing statement ── */}
          <StatementEditor
            label="Closing statement"
            value={template.closing_statement}
            onChange={onClosingStatementChange}
            defaultText=""
            mode={tmplMode}
          />
        </main>

        {/* ── AddItemDialog — template-aware per Task 32 ── */}
        <AddItemDialog
          open={addItemTarget !== null}
          onOpenChange={(open) => !open && setAddItemTarget(null)}
          estimateId={template.id}
          sectionId={addItemTarget?.sectionId ?? ""}
          onAdded={onLineItemAdded}
          mode={tmplMode}
        />
      </div>
    );
  }

  // ── Estimate-mode JSX ─────────────────────────────────────────────────────
  // state.entity is now narrowed to { kind: "estimate"; data: EstimateWithContents }
  const estimateEntity = state.entity; // narrowed
  const estimate = estimateEntity.data;
  const sections = estimate.sections;
  const mode = estimateEntity.kind;

  // ── Task 36: Apply Template banner gating ────────────────────────────────
  // Banner is hidden once the user has applied a template (even if zero
  // sections came in — e.g. statements-only template) OR once they've
  // manually added any section. Template-banner sets the localStorage flag
  // on successful apply.
  const appliedFlag =
    typeof window !== "undefined"
      ? localStorage.getItem(`nookleus.template-applied.${estimate.id}`) === "1"
      : false;
  const showTemplateBanner =
    state.entity.kind === "estimate" &&
    sections.length === 0 &&
    !appliedFlag;

  return (
    <div className="relative min-h-screen bg-background">
      {/* Voided banner */}
      {isVoided && (
        <div className="w-full bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2 text-sm text-destructive font-medium">
          <AlertOctagon size={16} />
          This estimate has been voided
          {estimate.void_reason && (
            <span className="font-normal text-destructive/80">
              — {estimate.void_reason}
            </span>
          )}
        </div>
      )}

      {/* Main content column. TotalsPanel — fixed bottom-right at desktop widths.
          Post-67a: responsive layout for mobile (overlap is expected on narrow viewports). */}
      <main className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-4">

        {/* ── SLOT 1: HeaderBar ────────────────────────────────────────────── */}
        <HeaderBar
          entity={estimateEntity}
          onTitleChange={onTitleChange}
          onVoid={onVoid}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          isVoiding={isVoiding}
          onConvertClick={() => setConvertOpen(true)}
        />

        {/* ── SLOT 2: MetadataBar ──────────────────────────────────────────── */}
        <MetadataBar
          entity={estimate}
          onIssuedDateChange={onIssuedDateChange}
          onValidUntilChange={onValidUntilChange}
          mode={mode}
        />

        {/* ── Task 36: Apply Template banner ───────────────────────────────── */}
        {showTemplateBanner && (
          <TemplateBanner
            estimateId={estimate.id}
            jobDamageType={job?.damage_type ?? null}
            onApplied={() => {
              router.refresh();
            }}
          />
        )}

        {/* ── SLOT 3: CustomerBlock ────────────────────────────────────────── */}
        {job && <CustomerBlock job={job} mode={mode} />}

        {/* ── SLOT 4: Opening statement ────────────────────────────────────── */}
        <StatementEditor
          label="Opening statement"
          value={estimate.opening_statement}
          onChange={onOpeningStatementChange}
          defaultText={defaultOpeningStatement}
          readOnly={isVoided}
          mode={mode}
        />

        {/* ── SLOT 5: Sections list (Task 24) ──────────────────────────────── */}
        {/* DndContext wraps the entire sections list. Each SectionCard contains
            its own inner SortableContexts for subsections and direct items,
            providing the drag-constraint boundaries described in spec §5.1. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {sections.length === 0 ? (
            /* Empty state — spec §10 */
            <div className="rounded-xl border-2 border-dashed border-border bg-card p-12 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-muted-foreground">
                Add a section to get started
              </p>
              <Button
                onClick={() => setShowAddSection(true)}
                size="sm"
                className="gap-1.5"
              >
                <Plus size={14} />
                New Section
              </Button>
            </div>
          ) : (
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3">
                {sections.map((sec, sIdx) => (
                  <SectionCard
                    key={sec.id}
                    section={sec}
                    onRename={onSectionRename}
                    onDelete={onSectionDelete}
                    onAddSubsection={onSubsectionAdd}
                    onAddLineItem={onAddLineItem}
                    onLineItemDelete={onLineItemDelete}
                    onLineItemChange={onLineItemChange}
                    onSubsectionRename={onSubsectionRename}
                    onSubsectionDelete={onSubsectionDelete}
                    onSubsectionLineItemDelete={onLineItemDelete}
                    readOnly={isVoided}
                    mode={mode}
                    sectionIdx={sIdx}
                  />
                ))}
              </ul>
            </SortableContext>
          )}

          {/* Add Section inline input — shown below the list */}
          <div className="mt-3 pt-3 border-t border-border">
            {showAddSection ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newSectionTitle}
                  maxLength={200}
                  placeholder="Section name"
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSectionTitle.trim()) {
                      void onAddSection(newSectionTitle.trim());
                    }
                    if (e.key === "Escape") {
                      setShowAddSection(false);
                      setNewSectionTitle("");
                    }
                  }}
                  className="h-8 text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (newSectionTitle.trim()) {
                      void onAddSection(newSectionTitle.trim());
                    }
                  }}
                  disabled={!newSectionTitle.trim()}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddSection(false);
                    setNewSectionTitle("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddSection(true)}
                className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
              >
                <Plus size={13} />
                Add Section
              </button>
            )}
          </div>
        </DndContext>

        {/* ── SLOT 6: Closing statement ────────────────────────────────────── */}
        <StatementEditor
          label="Closing statement"
          value={estimate.closing_statement}
          onChange={onClosingStatementChange}
          defaultText={defaultClosingStatement}
          readOnly={isVoided}
          mode={mode}
        />
      </main>

      {/* ── SLOT 7: TotalsPanel (sticky bottom-right) ─────────────────────── */}
      <TotalsPanel
        entity={estimateEntity}
        onMarkupChange={onMarkupChange}
        onDiscountChange={onDiscountChange}
        onTaxRateChange={onTaxRateChange}
        readOnly={isVoided}
        mode={mode}
      />

      {/* ── Task 26: AddItemDialog ────────────────────────────────────────── */}
      <AddItemDialog
        open={addItemTarget !== null}
        onOpenChange={(open) => !open && setAddItemTarget(null)}
        estimateId={estimate.id}
        sectionId={addItemTarget?.sectionId ?? ""}
        jobDamageType={job?.damage_type}
        onAdded={onLineItemAdded}
        mode={mode}
      />

      {/* ── Task 38: Convert confirmation modal ──────────────────────────── */}
      {state.entity.kind === "estimate" && (
        <ConvertConfirmModal
          open={convertOpen}
          onClose={() => {
            setConvertOpen(false);
            setAlreadyConvertedTo(null);
          }}
          estimateNumber={state.entity.data.estimate_number}
          jobNumber={job?.job_number ?? ""}
          alreadyConvertedTo={alreadyConvertedTo}
          onConfirm={handleConvertConfirm}
        />
      )}
    </div>
  );
}
