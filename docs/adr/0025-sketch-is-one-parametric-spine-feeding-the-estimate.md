# The Sketch is one parametric spine that feeds the existing Estimate

**Status:** Accepted
**Date:** 2026-06-30 — documents the measurement-engine architecture grilled in
planning (`/grill-with-docs`). No code yet; a PRD and issues follow. This ADR
captures the *shape* so the build does not fragment into separate, disagreeing
tools.
**Amended by:** [ADR 0026](0026-sketch-2d-editor-is-a-full-screen-plan-canvas.md)
— refines decision 2's iPad / Apple-Pencil-first framing of the 2D editor to
**desktop-first, full-screen everywhere** (not desktop-only), and settles Room
coordinate storage (normalized footprint + `origin`).

## Context

The business wants a high-quality measurement engine modeled on **MagicPlan**:
draw or scan a property's rooms, get floor/wall/ceiling area and perimeter, view a
2D plan and a 3D model, and price the work from real measurements instead of
guesses. The stated north star is a Matterport-class capture experience; LiDAR
scanning and iPad-first interaction are explicit requirements.

Three facts about the current app shape the decision:

- **It is a Capacitor app**, not pure web — a Next.js front-end in a native iOS
  shell (`ios/`, `capacitor.config.ts`), and the team already authors its own
  Swift Capacitor plugins (`EmailWidgetBridgePlugin.swift`). Native iOS
  capabilities (LiDAR, ARKit, Apple RoomPlan) are reachable, not walled off.
- **`three` / `@react-three/fiber` / `drei` are already dependencies** — an in-app
  3D renderer already exists.
- **There is already a first-class Estimate** (line items in sections, O&P,
  discount, tax, QuickBooks sync), plus a separate **item library** and **Estimate
  template** feature. There is also an existing photo **annotation** feature
  (`photo-annotator.tsx`) — freehand markup on top of a Photo, unrelated to this.

The risk this ADR exists to kill: a measurement engine, a LiDAR scanner, a 3D
viewer, and a MagicPlan-style estimator are four tempting-but-separate builds. Left
unintegrated they produce duplicate models of "how big is this room" and a second
estimating system that disagrees with QuickBooks. The decision is to collapse them
onto a single spine.

New domain terms **Sketch**, **Floor**, and **Room** are now first-class in
[CONTEXT.md](../../CONTEXT.md).

## Decision

1. **One canonical entity: the Sketch.** A Job's property is modeled as a **Sketch**,
   organized into one or more **Floors**; a Floor holds **Rooms**; a Room carries
   walls, openings (doors/windows), and detected objects
   (cabinets/appliances/fixtures). This parametric model — not any rendered image or
   captured mesh — is the single source of truth for the property's measurements.

2. **Capture method is an *input* to the Sketch, never a parallel artifact.** A
   Sketch can be authored by hand (2D drawing on the tablet) or populated by a LiDAR
   scan (Apple **RoomPlan**, wrapped in a Swift Capacitor plugin). A scan *fills in* a
   Sketch; it does not create a separate "scan" record. Consequently the **2D
   parametric editor is mandatory, not optional** — scans come out imperfect and must
   be corrected on the model, and non-LiDAR devices (older iPads, phones, desktop
   web) have no other way to author.

3. **Rooms are height-aware (2.5D).** A Room is a closed wall footprint + a ceiling
   height (a Floor-level default, e.g. 8′, overridable per Room) + wall thickness
   (MagicPlan-style interior/exterior defaults). Floor area, ceiling area, wall area
   (perimeter × height, less openings), perimeter, and volume all derive from that.
   This is the exact shape RoomPlan returns, so the LiDAR phase fills fields the model
   already has rather than forcing a schema change.

4. **"3D" in the initial scope is an *extruded view* of the parametric Sketch**, not
   photoreal capture. The 2D plan extrudes in the existing three.js stack into an
   orbitable dollhouse; authoring stays 2D (precise, tablet-friendly) and the 3D is
   read-only. The **LiDAR mesh** (untextured geometry) and a **360°/Matterport
   photoreal walkthrough** are later, separate fidelity levels — explicitly **out of
   scope here**, and a build-vs-buy decision when their time comes.

5. **Measurements feed the *existing* Estimate; the Sketch is not a second
   estimator.** A Sketch does **not** grow its own price lists or estimate templates
   (the MagicPlan model). Instead an Estimate line item draws its quantity from a Room
   measurement as a **re-pullable snapshot**: the line item remembers its source
   (Room + measurement kind) but **freezes the value**, re-pulled only on an explicit
   user action. Quantities are **never live-linked** — editing or re-scanning a Sketch
   never rewrites a sent Estimate. This matches the repo's snapshot culture (template
   line items, [ADR 0004](0004-template-line-items-snapshot.md); PDF layout,
   [ADR 0012](0012-pdf-layout-is-a-per-document-snapshot.md); immutable signed
   contracts, [ADR 0011](0011-signed-contract-pdfs-are-immutable.md)). QuickBooks and
   the existing Estimate stay the single source of truth for money.

6. **Explicit scope boundaries (the no's matter as much as the yes's).**
   - **Interior rooms only.** Roof/exterior measurement is out — it is different
     geometry (pitched planes → squares) and is better *integrated* from aerial
     providers (EagleView/Hover) than drawn. It does not share the Room model.
   - **Object detection is inventory, not precise measurement.** Detected objects are
     RoomPlan's native categories, used for a documented inventory and **count-based**
     line items (e.g. detach-&-reset ×N). RoomPlan's bounding boxes are too loose to
     bill cabinet linear footage or countertop area off of; precise object measurement
     stays manual or waits for a later, more careful pass.
   - **Capture is RoomPlan + hand-draw only.** On a LiDAR device, Apple RoomPlan is
     the assisted-capture path; everywhere else (and on desktop) a Room is drawn by
     hand. Field capture **standardizes on LiDAR hardware** (iPad Pro / iPhone Pro),
     so we deliberately do **not** build a non-LiDAR AR corner-capture pipeline to
     reproduce what RoomPlan already provides on the devices that have LiDAR.

7. **The Sketch is unrelated to photo annotation.** The existing `annotation` feature
   is freehand markup on a Photo image; the Sketch is room geometry. They share no
   table, type, or component.

## Consequences

- **Native iOS work.** LiDAR capture is a Swift Capacitor plugin wrapping RoomPlan
  (iOS 16+, LiDAR devices only — iPad Pro / iPhone Pro). The app must degrade
  gracefully where LiDAR is absent: the Sketch (model + 2D editor + extruded 3D)
  works everywhere; scanning is an enhanced capture path simply not offered on
  unsupported devices.
- **New persistence.** Sketch / Floor / Room (plus walls, openings, objects) get their
  own tables, following the repo's hand-written-migration convention. The captured
  mesh/USDZ, if retained, lives in storage (parallel to how Photos store blobs),
  referenced from the Sketch — not inlined in the row.
- **Estimate line items gain a measurement source reference.** To support snapshot +
  re-pull, a line item sourced from a Sketch records its source Room + measurement
  kind alongside the frozen quantity. Re-pull recomputes from the live Sketch on an
  explicit user action only.
- **The 2D editor is on the critical path even for the "LiDAR-first" experience.**
  Shipping scanning does not let us skip building the parametric editor.
- **One model, rendered two ways.** The same Sketch drives the 2D plan and the 3D
  extrusion; a later LiDAR mesh enriches it without replacing it.
- **Deferred but not forgotten.** The object→line-item mapping, the 2D authoring
  interaction (dimension entry, snapping, Apple Pencil), where the Sketch surfaces in
  the UI, and the storage schema are settled in the forthcoming PRD/issues, not here.
  (Job→Sketch cardinality — 1:1 — and the capture decision above are settled.) This
  ADR fixes only the spine.

## Considered options

- **Treat a LiDAR scan as its own artifact** (a "Scan" entity separate from a
  hand-drawn Sketch). Rejected: it forks "how big is this room" into two models that
  drift, and forces every consumer (estimate feed, 3D view, reports) to know which
  kind it is looking at. Capture-as-input keeps one model.
- **Rebuild MagicPlan's estimating inside Nookleus** (Sketch-side price lists +
  estimate templates that emit an estimate). Rejected: it stands up a second
  estimating engine beside the one QuickBooks already syncs, guaranteeing
  disagreement. The Sketch feeds the existing Estimate instead.
- **Live-linked quantities.** Rejected: it lets a sketch edit silently change a sent,
  customer-approved Estimate — the exact failure the repo's snapshot culture exists to
  prevent.
- **3D authoring** (drag walls in 3D space). Rejected: far harder to build and far
  worse on an iPad than 2D authoring with a 3D view.
- **Roofs in the same engine.** Rejected: different geometry and a different
  acquisition path; folding it in would bend the Room model out of shape.
- **Pure-web / no native.** Moot — the app is already Capacitor with custom Swift
  plugins, so the native path LiDAR requires is already open.
