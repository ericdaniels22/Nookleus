// src/lib/pdf-renderer/components/sections-table.tsx
// Renders the hierarchical sections + subsections + line items for both estimates and invoices.
// Pure function of (sections, lineItems, preset) — no DB access.

import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type {
  PdfPreset, EstimateSection, EstimateLineItem, InvoiceSection, InvoiceLineItem,
} from "@/lib/types";

type Section = EstimateSection | InvoiceSection;
type LineItem = EstimateLineItem | InvoiceLineItem;

interface Props {
  sections: Section[];
  lineItems: LineItem[];
  preset: PdfPreset;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// EstimateLineItem stores the row total as `total`; InvoiceLineItem as `amount`.
// Falls back to qty * unit_price if neither is set (defensive — not expected at runtime).
function lineTotal(i: LineItem): number {
  const stored = "total" in i ? i.total : i.amount;
  return Number(stored ?? Number(i.quantity) * Number(i.unit_price));
}

// Build {parentId | null → children} map; sections without a parent_section_id are top-level.
function groupSections(all: Section[]): { tops: Section[]; childrenOf: Map<string, Section[]> } {
  const tops: Section[] = [];
  const childrenOf = new Map<string, Section[]>();
  for (const s of all.slice().sort((a, b) => a.sort_order - b.sort_order)) {
    if (s.parent_section_id) {
      const list = childrenOf.get(s.parent_section_id) ?? [];
      list.push(s);
      childrenOf.set(s.parent_section_id, list);
    } else {
      tops.push(s);
    }
  }
  return { tops, childrenOf };
}

function itemsForSection(items: LineItem[], sectionId: string): LineItem[] {
  return items.filter((i) => i.section_id === sectionId).slice().sort((a, b) => a.sort_order - b.sort_order);
}

function sectionSubtotal(items: LineItem[]): number {
  return items.reduce((s, i) => s + lineTotal(i), 0);
}

export function SectionsTable({ sections, lineItems, preset }: Props) {
  const { tops, childrenOf } = groupSections(sections);

  function renderItemRow(item: LineItem, key: string) {
    const total = lineTotal(item);
    const itemName = item.name ?? null;
    return (
      <View key={key} style={styles.tr} wrap={false}>
        {preset.show_code_column && <Text style={styles.tdCode}>{item.code ?? ""}</Text>}
        <View style={styles.tdDesc}>
          {itemName && <Text style={styles.tdName}>{itemName}</Text>}
          <Text>{item.description}</Text>
        </View>
        <Text style={styles.tdQty}>{Number(item.quantity)}</Text>
        <Text style={styles.tdUnit}>{item.unit ?? ""}</Text>
        <Text style={styles.tdPrice}>{fmt(Number(item.unit_price))}</Text>
        <Text style={styles.tdTotal}>{fmt(total)}</Text>
        {preset.show_notes_column && <Text style={styles.tdNotes}>{/* always empty for v1 */}</Text>}
      </View>
    );
  }

  function renderSection(section: Section, depth: number, sectionKey: string) {
    const directItems = itemsForSection(lineItems, section.id);
    const subs = (childrenOf.get(section.id) ?? []);
    const subItems = subs.flatMap((s) => itemsForSection(lineItems, s.id));
    const sectionTot = sectionSubtotal([...directItems, ...subItems]);

    return (
      <View key={sectionKey}>
        <View style={depth === 0 ? styles.sectionHeader : styles.subsectionHeader} wrap={false}>
          <Text>{section.title}</Text>
        </View>
        {directItems.map((it, i) => renderItemRow(it, `${sectionKey}-it-${i}`))}
        {subs.map((sub, i) => renderSection(sub, depth + 1, `${sectionKey}-sub-${i}`))}
        {preset.show_category_subtotals && depth === 0 && (
          <View style={styles.sectionSubtotal} wrap={false}>
            <Text>Section subtotal: {fmt(sectionTot)}</Text>
          </View>
        )}
      </View>
    );
  }

  if (tops.length === 0) return null;

  return (
    <View style={styles.table}>
      {/* Header row */}
      <View style={styles.thRow} wrap={false}>
        {preset.show_code_column && <Text style={styles.tdCode}>Code</Text>}
        <Text style={styles.tdDesc}>Description</Text>
        <Text style={styles.tdQty}>Qty</Text>
        <Text style={styles.tdUnit}>Unit</Text>
        <Text style={styles.tdPrice}>Unit Cost</Text>
        <Text style={styles.tdTotal}>Total</Text>
        {preset.show_notes_column && <Text style={styles.tdNotes}>Notes</Text>}
      </View>
      {tops.map((s, i) => renderSection(s, 0, `t-${i}`))}
    </View>
  );
}
