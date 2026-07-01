"use client";

import {
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import type { SVGPresentationAttributes } from "@react-pdf/types";

import PageFooter from "./page-footer";
import type { PlanRender } from "@/lib/sketch/plan-render";

const colors = {
  text: "#1A1A1A",
  muted: "#666666",
  eyebrow: "#999999",
  wall: "#1A1A1A",
  fill: "#F3F4F6",
  dimension: "#444444",
};

// The plan is authored in feet. The Svg maps that feet-based viewBox onto a
// point-sized box on the page, so every length inside — stroke widths, label
// font sizes — is divided by `scale` to land at a fixed on-page size regardless
// of how large or small the Floor is. `MAX_SCALE` keeps a tiny plan from being
// blown up to fill the whole page.
const CONTENT_WIDTH = 532; // LETTER width (612) minus the 40pt side padding.
const PLAN_MAX_HEIGHT = 600; // Room left under the heading and above the footer.
const MAX_SCALE = 48; // pt per foot.

const WALL_STROKE_PT = 1.25;
const ROOM_NAME_PT = 11;
const ROOM_AREA_PT = 8.5;
const DIMENSION_PT = 8;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },
  header: {
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: colors.eyebrow,
    marginBottom: 4,
  },
  floorName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
  },
  planArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  emptyNote: {
    marginTop: 48,
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
});

/**
 * An SVG text label. @react-pdf draws SVG `<Text>` with `fontSize`/`fontFamily`
 * at render time — they ride the viewBox transform — but its typed style only
 * admits presentation attributes, so we widen the shape here with no cast.
 */
interface PlanLabelStyle extends SVGPresentationAttributes {
  fontSize: number;
  fontFamily?: string;
}

interface SketchPlanPageProps {
  plan: PlanRender;
  pageNumber?: number;
  totalPages?: number;
}

/**
 * Issue #868 — a Photo Report page rendering a Floor's dimensioned 2D plan
 * (AC2). Everything drawn here comes pre-computed in {@link PlanRender}: the
 * page owns no geometry, only the feet→points scaling and the styling. ADR 0026
 * makes this a separate render from the interactive Fabric editor.
 */
export default function SketchPlanPage({
  plan,
  pageNumber,
  totalPages,
}: SketchPlanPageProps) {
  const { width, height } = plan.viewBox;
  const scale = Math.min(
    CONTENT_WIDTH / width,
    PLAN_MAX_HEIGHT / height,
    MAX_SCALE,
  );

  const nameStyle: PlanLabelStyle = {
    fontSize: ROOM_NAME_PT / scale,
    fontFamily: "Helvetica-Bold",
    fill: colors.text,
    textAnchor: "middle",
  };
  const areaStyle: PlanLabelStyle = {
    fontSize: ROOM_AREA_PT / scale,
    fill: colors.muted,
    textAnchor: "middle",
  };
  const dimStyle: PlanLabelStyle = {
    fontSize: DIMENSION_PT / scale,
    fill: colors.dimension,
    textAnchor: "middle",
  };
  const wallStyle: SVGPresentationAttributes = {
    fill: colors.fill,
    stroke: colors.wall,
    strokeWidth: WALL_STROKE_PT / scale,
    strokeLinejoin: "miter",
  };

  const hasRooms = plan.rooms.length > 0;

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SKETCH PLAN</Text>
        <Text style={styles.floorName}>{plan.floorName}</Text>
      </View>

      <View style={styles.planArea}>
        {hasRooms ? (
          <Svg
            width={width * scale}
            height={height * scale}
            viewBox={`0 0 ${width} ${height}`}
          >
            {plan.rooms.map((room, i) => (
              <Polygon
                key={`poly-${i}`}
                points={room.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                style={wallStyle}
              />
            ))}
            {plan.rooms.map((room, i) => (
              <Text
                key={`name-${i}`}
                x={room.labelAt.x}
                y={room.labelAt.y}
                style={nameStyle}
              >
                {room.name}
              </Text>
            ))}
            {plan.rooms.map((room, i) => (
              <Text
                key={`area-${i}`}
                x={room.labelAt.x}
                y={room.labelAt.y + ROOM_NAME_PT / scale}
                style={areaStyle}
              >
                {room.areaLabel}
              </Text>
            ))}
            {plan.rooms.map((room, ri) =>
              room.wallLabels.map((wall, wi) => (
                <Text
                  key={`dim-${ri}-${wi}`}
                  x={wall.x}
                  y={wall.y}
                  style={dimStyle}
                >
                  {wall.text}
                </Text>
              )),
            )}
          </Svg>
        ) : (
          <Text style={styles.emptyNote}>No rooms drawn on this Floor yet.</Text>
        )}
      </View>

      <PageFooter
        sectionTitle={plan.floorName}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}
