# The Sketch 2D editor is a full-screen, desktop-first plan canvas; Rooms carry a Floor position and are placed before they are assembled

**Status:** Accepted
**Date:** 2026-06-30 — settles part of what [ADR 0025](0025-sketch-is-one-parametric-spine-feeding-the-estimate.md) deferred ("the 2D authoring interaction … where the Sketch surfaces in the UI, and the storage schema are settled in the forthcoming PRD/issues, not here"). Grilled in planning (`/grill-with-docs`) off the shipped tracer (#879); implemented by #890.
**Amends:** [ADR 0025](0025-sketch-is-one-parametric-spine-feeding-the-estimate.md) — refines its iPad / Apple-Pencil-first framing of the 2D editor to desktop-first / full-screen, and settles Room coordinate storage.

## Context

The first Sketch tracer (#860 → #879, merged) is a deliberately-minimal drawing
surface: a single Room, tapped corner-to-corner on a small dark grid boxed inside a
centered form, its six measurements in a side panel. It proves the pure measurement
core (M1) end-to-end but does not *read* as a floor plan, and the product owner's
reaction to it on prod was direct — "I hate the UI; I want it to look like
MagicPlan," with a **full-screen desktop UI** named as the single most important
thing.

[ADR 0025](0025-sketch-is-one-parametric-spine-feeding-the-estimate.md) fixed the
*spine* (one parametric Sketch → Floors → Rooms feeding the existing Estimate) but
explicitly deferred the 2D editor's interaction, its placement in the UI, and Room
storage to "the forthcoming PRD/issues." It also framed authoring as **iPad-first,
with Apple Pencil** — a reasonable field-capture assumption, but the owner authors
and reviews on desktop.

This ADR settles the three coupled questions the "make it look like MagicPlan"
redesign forces — questions the assembly (#865) and within-Room editing (#862)
slices then build on. It is implemented by **#890**.

## Decision

1. **The 2D editor is a full-screen, desktop-first plan canvas — full-screen
   *everywhere*, not desktop-only.** It replaces the centered-form layout with an
   edge-to-edge, pan/zoom canvas workspace (the MagicPlan / Figma shape): a slim top
   bar, a right **inspector** for the selected Room, a bottom-floating zoom control.
   Interaction is **mouse-first** (click-to-place, click-drag to move, wheel to
   zoom); touch and Apple Pencil remain valid input paths, not the primary framing.
   This **refines ADR 0025's iPad / Pencil-first authoring assumption without
   dropping it** — the LiDAR capture-then-correct loop (Phase 3, #863 / #871) still
   corrects scans on this same surface, so the editor must stay fully usable on an
   iPad; it is simply designed and optimized desktop-first.

2. **Rooms are *placed* before they are *assembled*.** Multiple Rooms render on one
   Floor canvas and are arranged by **free drag** — no shared-wall snapping in this
   step. Snapping, collinear-merge assembly (M4), the Statistics panel (M2), and
   multi-Floor navigation stay in **#865**. Free placement is an honest interim
   *toward* assembly, not a replacement: it makes the canvas read as a plan now, and
   #865 upgrades *free placement* to *snapped assembly* by adjusting positions, not
   by re-modeling.

3. **A Room's shape and its position are stored separately: normalized footprint +
   `origin`.** The `footprint` polygon is stored **normalized** (its min corner at
   `(0,0)`), and the Room gains an **`origin {x,y}`** — its position in the Floor's
   coordinate space. Moving a Room updates only `origin`; the footprint never
   changes. Measurements (M1) are position-invariant and so are untouched by a move.
   This is the model assembly wants anyway: #865 snapping becomes "adjust `origin`s
   and compare walls in Floor space," never a polygon rewrite.

4. **Wall thickness is not rendered in 2D yet — walls are a thick black
   *centerline* stroke.** The MagicPlan black-wall *look* is achieved with a bold
   stroke on the footprint edges, deliberately **not** thickness-aware double-line
   poché. True thickness geometry (interior / exterior offset, mitered corners) stays
   where ADR 0025 already put it — the 3D extrusion (M9 / #870) and shared-wall
   assembly (#865) — because rendering it in 2D forces a measurement-semantics
   decision (is the drawn footprint the wall centerline, interior face, or exterior
   face?) that we are not ready to make and do not need for the visual.

## Consequences

- **Migration + backfill.** `rooms` gains `origin` (default `(0,0)`); existing
  footprints are normalized to their own min corner and given an `origin` — trivial,
  as there are no real Rooms in prod yet. The server stays the single writer of the
  cached measurements, which do not change.
- **The editor shell becomes a shared foundation.** #862 (within-Room editing:
  vertex drag, per-wall length, Pencil, M4 collinear-merge) and #865 (snapping,
  Statistics, multi-Floor) both build *inside* the #890 shell rather than standing up
  their own canvas. Cross-link notes are posted on both.
- **On-canvas labels are owned here.** Per-Room name + area labels and always-on
  per-wall dimension labels — previously unowned by any slice — render in this
  editor. The Photo-Report "dimensioned plan" page (#868) is a separate render and
  is unaffected.
- **iPad authoring is preserved, not dropped.** Desktop-first is a design priority,
  not an exclusion; graceful degradation to tablet / touch (and the RoomPlan
  correction loop) remains a requirement.

## Considered options

- **Restyle the single-Room tracer only** (light theme + thick walls, still one
  Room). Rejected: a lone Room on a full-screen canvas reads as *emptier* than
  today's small canvas; multi-Room placement (with zoom) is what makes it read as a
  plan.
- **Pull the full assembly slice (#865) forward** — snapping, Statistics,
  multi-Floor now. Rejected: much larger, and the shared-wall geometry (M4) is real
  work; free placement delivers the "looks like a plan" win at a fraction of the cost
  and leaves #865 intact.
- **Global (un-normalized) footprint coordinates** — bake position into the points,
  no `origin`. Rejected: fuses shape and position, so every move rewrites the polygon
  and #865 must diff raw point clouds; normalized-footprint + `origin` keeps position
  a cheap, first-class field.
- **Thickness-aware double-line walls in 2D now.** Rejected: heavier geometry, and
  it forces a footprint-semantics decision (centerline vs. interior vs. exterior
  face) that ripples into M1; the thick centerline stroke gets ~90% of the look for
  ~10% of the cost.
- **Desktop-only editor.** Rejected: it strands ADR 0025's capture-then-correct
  loop, which corrects LiDAR scans on this same 2D surface on an iPad in the field.
