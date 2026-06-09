"use client";

import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { RenderTag } from "@/lib/report-render-model";

/**
 * Pick a legible text color for a chip painted in `hex`: white on dark
 * backgrounds, near-black on light ones. Uses perceived brightness (the YIQ
 * luma) so mid-bright hues like yellow read as "light". Unparseable colors
 * fall back to dark text on the assumption the chip is light.
 */
export function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#1A1A1A";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 150 ? "#1A1A1A" : "#FFFFFF";
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  chip: {
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  label: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
  },
});

interface TagChipsProps {
  tags: RenderTag[];
}

/**
 * A wrapping row of small colored chips — one per photo tag, each painted in
 * its tag's color with contrasting text. Renders nothing when there are no
 * tags, so callers can drop it in unconditionally.
 */
export default function TagChips({ tags }: TagChipsProps) {
  if (tags.length === 0) return null;
  return (
    <View style={styles.row}>
      {tags.map((tag, i) => (
        <View
          key={`${tag.name}-${i}`}
          style={[styles.chip, { backgroundColor: tag.color }]}
        >
          <Text style={[styles.label, { color: chipTextColor(tag.color) }]}>
            {tag.name}
          </Text>
        </View>
      ))}
    </View>
  );
}
