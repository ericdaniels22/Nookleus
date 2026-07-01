import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import { getOrCreateJobSketch } from "@/lib/sketch/job-sketch";
import PlanEditor from "@/components/plan-editor";
import type { Floor, Room } from "@/lib/types";

// The Job-scoped Sketch builder route (#860). A builder route in the AppShell
// `BUILDER_ROUTE_PATTERNS` sense — the nav renders as the slim collapsed rail
// beside it. Opening the surface establishes the Job's Sketch (and its first
// Floor) on first visit and loads it on every visit after (getOrCreateJobSketch,
// idempotent), then hands the active Floor + saved Rooms to the client builder.

// PostgREST returns `numeric` columns as strings; the client builder does
// arithmetic on them, so coerce to numbers at the server boundary.
function n(value: number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

export default async function SketchBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = await params;
  const supabase = await createServerSupabaseClient();

  const auth = await requirePagePermission(supabase, { permission: "edit_jobs" });
  if (!auth.ok || !auth.orgId) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
          <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold text-foreground">
            Access restricted
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            You don&apos;t have permission to edit this job&apos;s sketch.
          </p>
          <Link
            href="/jobs"
            className="inline-block mt-4 text-sm font-medium text-[#2B5EA7] hover:underline"
          >
            Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  // The URL's Job must be visible to the caller's org before we touch its
  // Sketch (mirrors the rooms route's #446 guard). A cross-org or unknown id
  // resolves to no row under RLS — 404, leaking no existence oracle.
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle<{ id: string }>();
  if (!job) {
    notFound();
  }

  // Create-or-load the Job's single Sketch + its first Floor.
  const { sketchId } = await getOrCreateJobSketch(supabase, {
    organizationId: auth.orgId,
    jobId,
  });

  // The Sketch's Floors (the first is the active one for this tracer slice) and
  // every Room saved on them, oldest first so the list is stable across reloads.
  const { data: floorRows } = await supabase
    .from("floors")
    .select("*")
    .eq("sketch_id", sketchId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<Floor[]>();
  const floors: Floor[] = (floorRows ?? []).map((f) => ({
    ...f,
    default_ceiling_height: n(f.default_ceiling_height),
    interior_wall_thickness: n(f.interior_wall_thickness),
    exterior_wall_thickness: n(f.exterior_wall_thickness),
    sort_order: Number(f.sort_order),
  }));
  const floor = floors[0];

  const { data: roomRows } = floor
    ? await supabase
        .from("rooms")
        .select("*")
        .eq("floor_id", floor.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .returns<Room[]>()
    : { data: [] as Room[] };
  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    ...r,
    // `footprint` and `origin` are jsonb — PostgREST returns them already
    // parsed, so they pass through as-is (unlike the numeric columns, which
    // arrive as strings). `origin` is the Room's position on the Floor (ADR
    // 0026); a legacy row missing it reads as (0,0).
    footprint: Array.isArray(r.footprint) ? r.footprint : [],
    origin:
      r.origin && typeof r.origin === "object"
        ? r.origin
        : { x: 0, y: 0 },
    width: n(r.width),
    length: n(r.length),
    ceiling_height_override:
      r.ceiling_height_override == null ? null : Number(r.ceiling_height_override),
    floor_area: n(r.floor_area),
    ceiling_area: n(r.ceiling_area),
    perimeter: n(r.perimeter),
    gross_wall_area: n(r.gross_wall_area),
    net_wall_area: n(r.net_wall_area),
    volume: n(r.volume),
    sort_order: Number(r.sort_order),
  }));

  // A freshly-created Sketch always has a Floor (getOrCreateJobSketch seeds one);
  // this guards only the impossible empty case so the builder always has one.
  if (!floor) {
    notFound();
  }

  return (
    <PlanEditor
      jobId={jobId}
      sketchId={sketchId}
      floor={floor}
      initialRooms={rooms}
    />
  );
}
