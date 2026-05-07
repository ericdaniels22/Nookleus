---
date: 2026-05-06
build_id: 15d
session_type: manual-test
related: ["[[build-15d]]", "[[2026-05-06-build-15d-implementation]]"]
spec: docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md
deploy_commit: 96eebeb
---

# Build 15d — §11 Manual Test Pass Results

Tests run against Vercel deploy of `4208e54` (org: AAA prod / Test Co).

Legend: ✅ PASS · ❌ FAIL · ⏸ BLOCKED · ⏭ NOT YET RUN

## Summary

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1a | Click "+ Upload Contract PDF" → editor (Bug 1 verify) | ✅ | Fix `96eebeb` verified in AAA prod. New row "Untitled Template (2)" created (suffix logic skipped existing "Untitled Template" + "(copy 2)"). |
| 1b | Upload AAA FM-7001 PDF | ✅ | After Bug 2 fix `934883b` deployed. PDF renders at responsive scale 0.588 (360×466 CSS px per page) on AAA prod, full headings + body text legible. |
| 2 | Place all 5 overlay fields | ⏭ | |
| 3 | Move and resize a field | ⏭ | |
| 4 | Add Input + Checkbox | ⏭ | |
| 5 | Add Free-text label | ⏭ | |
| 6 | Preview stamped sample | ⏭ | |
| 7 | Send to test customer | ⏭ | |
| 8 | Sign as customer | ⏭ | |
| 9 | Verify stamped PDF | ⏭ | |
| 10 | Two-signer template | ⏭ | |
| 11 | Replace PDF | ⏭ | |
| 12 | Legacy contract readable | ⏭ | |

## Test details

### 1a. Click "+ Upload Contract PDF" lands in editor (Bug 1 verify)

**Spec:** CTA → POST `/api/settings/contract-templates` returns 200 → router pushes to `/settings/contract-templates/{id}/edit` → upload zone renders. No "Failed to create template" toast.

**Result:** ✅ PASS in AAA prod against deploy of `96eebeb` (2026-05-06, ~6:48 PM PT). Click → navigated to `/settings/contract-templates/d9767028-d054-40e1-886f-1396af224307/edit`. Editor rendered the empty `<TemplatePdfUploadZone>` (Upload icon, "Upload Contract PDF" heading, body copy, "Choose PDF" button, "10 MB max" caption). Templates list reloaded to show new row **"Untitled Template (2)"** (Archived, no PDF, 1 signer, 6:48 PM) — confirms the `pickUniqueTemplateName` suffix logic from the fix correctly skipped the existing "Untitled Template" (Archived, 5:10 PM) and "Untitled Template (copy 2)" (Active, 5:10 PM) rows. Bug 1 closed.

---

### 1b. Upload AAA's FM-7001 PDF

**Spec:** Editor renders all 5 pages; page count badge shows "5 pages".

**Result:** ✅ PASS after Bug 2 fix `934883b`. PDF uploaded onto template `60862e63-59dc-4529-84e2-84724774ea3a` ("Untitled Template (3)") via "Copy of RC Work Authorization.pdf" — 5 pages, 286 KB. After fix deployed, editor renders all 5 pages at responsive scale (0.588× on a 1512-CSS-px viewport, yielding 360×466 CSS px per page). All headings + body sections legible. Page count is implicit (5 canvases rendered) — there's no numeric "5 pages" badge in the editor header (header shows "← Templates" + "v2") so that part of the spec is aspirational vs shipped UI; not blocking. **Bug 2 caveat:** see below — fix changed the editor's working scale from a fixed 1.5× to fit-to-container, which on this viewport renders pages at ~60% of the original size. Field placement at small scale is workable but may feel cramped; UX refinement of editor column widths is a separate follow-up.

---

---

### 2. Place all 5 overlay fields

**Spec:** Page 4 county merge, page 5 NAME merge + SERVICE LOCATION merge + CUSTOMER SIGNATURE signature + DATE date. Save (auto + manual). Reload editor — all 5 fields persist at exact pixel positions.

**Result:** _pending_

---

### 3. Move and resize a field

**Spec:** Drag NAME merge field 50pt down + 100pt right; resize to 300pt × 20pt. Save. Reload — exact new position.

**Result:** _pending_

---

### 4. Add an Input field + a Checkbox

**Spec:** Add input "Special Instructions" + checkbox "I agree to terms". Save. Reload — both persist with their `inputKey` + label + required flag.

**Result:** _pending_

---

### 5. Add a Free-text label

**Spec:** Type "INTERNAL USE ONLY" at top of page 1. Save + reload.

**Result:** _pending_

---

### 6. Preview

**Spec:** Click Preview — opens stamped sample PDF in new tab — all 7 fields visible with sample values + sample signature image.

**Result:** _pending_

---

### 7. Send the contract

**Spec:** Send to test customer (Eric's `+t1` alias). Resend dispatches; email arrives with link.

**Result:** _pending_

---

### 8. Sign as customer

**Spec:** Open link → all merges show resolved values, input is blank with placeholder, checkbox is unchecked, signature placeholder is hatched. Submit before filling required fields → error toast "Required: …". Fill input, check box, sign. Submit succeeds.

**Result:** _pending_

---

### 9. Verify stamped PDF

**Spec:** Download stamped PDF from contract detail view — opens in a real PDF reader — all 7 fields visible at correct positions with correct values + signature image baked in.

**Result:** _pending_

---

### 10. Two-signer template

**Spec:** Re-create a template with `signer_count=2`. Place two signature fields with `signerIndex=0` and `signerIndex=1`. Send. First signer signs → status `partially_signed`, only signer 0's image appears in stamped PDF. Send second signing link → second signer signs → status `signed`, both signature images present.

**Result:** _pending_

---

### 11. Replace PDF

**Spec:** Edit an existing template, click Replace PDF, upload a different PDF. Overlay fields wipe with confirm. New PDF + empty fields.

**Result:** _pending_

---

### 12. Legacy contract still readable

**Spec:** A contract signed before this build (with `filled_content_html` populated) opens correctly in the contract detail view.

**Result:** _pending_

---

## Bugs found during pass

### Bug 1 — "Upload Contract PDF" → "Failed to create template" (500)

**Surfaced in:** Test 1, before any artifact created.

**Symptom:** Click CTA → red toast "Failed to create template". Network shows POST /api/settings/contract-templates returning 500 with redacted `{ error: "internal error" }`.

**Root cause:** `POST /api/settings/contract-templates` insert hard-coded `name: "Untitled Template"`, hitting the `contract_templates_org_name_key` unique index on `(organization_id, name)` (added in build46) whenever an `Untitled Template` row already existed for the active org. Apparently 6+ stale rows in Test Co from prior dev attempts — every click after the first dupes.

**Postgres log evidence:**
```
ERROR: duplicate key value violates unique constraint "contract_templates_org_name_key"
```

Six occurrences across roughly a five-minute window.

**Fix:** Commit `96eebeb` — route now SELECTs existing names matching the requested base, derives a non-colliding candidate by appending `" (2)"`, `" (3)"`, … up to 999 before insert. Race against concurrent inserts is academic for a single-admin click flow; the unique index remains as the safety net.

**Pre-existing dupe related-vulnerability:** `/api/settings/contract-templates/[id]/duplicate/route.ts:35` does `${source.name} (Copy)` and would 500 on the second duplicate of the same source. Not blocking 15d but worth noting — separate fix.

### Bug 2 — PDF canvas clips on both sides at laptop viewports (blocks Tests 2–5)

**Surfaced in:** Test 1b, immediately after the FM-7001 PDF was uploaded onto template `60862e63-59dc-4529-84e2-84724774ea3a`.

**Symptom:** The PDF heading "EMERGENCY SERVICES CONTRACT & WORK AUTHORIZATION" displays as two visually-stacked clipped fragments — `EMERGENCY SERVICES` (right side cut) and `TRACT & WORK AUTHORIZAT` (both `CON` prefix and `ION` suffix cut). At 1512-CSS-px viewport (Vanessa's MacBook): user cannot see the full PDF page width. No horizontal scrollbar visible to recover the clipped content.

**Root cause:** `src/components/contracts/pdf-canvas.tsx:28` defaults `scale = 1.5` and `:55-59` renders every page at `width: meta.width_pt * scale` (918 CSS px for letter-size 612pt). No responsive fit-to-container logic. While `template-pdf-editor.tsx:195` wraps the canvas in `<main className="flex-1 overflow-auto …">`, the flex math against the `<FieldPalette>` left column + `<FieldInspector>` right column on a 1512-wide viewport leaves the middle column narrower than 918 — and the canvas pages aren't producing the expected horizontal scroll on this layout.

**Why Test 1a still passed:** the bug only manifests once a PDF is rendered into the canvas. Test 1a verified routing into the editor's empty `<TemplatePdfUploadZone>` state, which sits at full container width and isn't affected.

**Impact:** Blocks Tests 2–5 (field placement requires authors to drop chips at exact pixel positions on a fully-visible page). Tests 6–12 are likely also blocked (signing-side `<ContractSignerView>` may share `<PdfCanvas>` and inherit the same scale bug — needs verification).

**Fix candidates:**
1. Make `<PdfCanvas>` responsive: measure wrapper width via `ResizeObserver`, compute `scale = wrapperWidth / page.width_pt`, re-render on resize. Drop coordinates store PDF-points (line 73) so scale changes are safe.
2. Cap `scale` at `Math.min(1.5, wrapperWidth / page.width_pt)` to retain crispness when there's room.
3. Either way, also confirm `<ContractSignerView>` doesn't share the same flaw (signing pages run on customer browsers of unknown widths).

**Fix shipped:** Commit `934883b` — implements (1) + (2). `<PdfCanvas>` now uses `ResizeObserver` to measure its wrapper, computes `fitScale = (containerWidth - 16) / maxPageWidthPt`, sets actual `scale = Math.min(maxScale=1.5, fitScale)`. `<Document>` render is gated until first measurement to avoid a double-render flash. Existing `scale` prop preserved as a max cap. Verified post-deploy: editor canvas now 360 CSS px on a 1512-px viewport (was 918), full PDF page visible. `<ContractSignerView>` automatically inherits the fix since it consumes the same `<PdfCanvas>`.

**Editor-layout refinement (still open):** With the fit fix, the PDF page renders at ~60% of native size on a 1512 viewport because the editor's middle `<main>` is only 376 CSS px wide (FieldPalette ~360 + Inspector ~184 + ~250 settings sub-nav eat into the available 1304 page-main width). Author can still drop fields with sufficient accuracy (PDF-point coords, sub-pixel tolerable) but the cramped middle column is uncomfortable. Worth a follow-up to slim FieldPalette / Inspector or make them collapsible. Not blocking 15d ship.

### Bug 3 — dropping any chip immediately deselects it (blocks editing)

**Surfaced in:** Test 2 setup, while attempting to place fields after Bug 2 fix went live.

**Symptom:** Author drags a chip from `<FieldPalette>`, drops on a PDF page. Chip appears at the drop location but is **not selected** — no resize handles, no trash button, inspector still says "Select a field to edit its properties." Author cannot configure the field.

**Root cause:** `template-pdf-editor.tsx:197` puts an `onClick={() => setSelectedFieldId(null)}` on the editor's `<main>` (the click-anywhere-empty-to-deselect pattern). After drop, Chrome's HTML5 drag-and-drop machinery dispatches a click that bubbles from the freshly-mounted chip up to `<main>`, deselecting it. `OverlayFieldChip` had no `onClick` of its own, so nothing intercepted the bubble. Subsequent direct clicks on the chip would have suffered the same fate (click bubbles → main deselects).

**Fix:** Commit `2a2bc32` — added `onClick={(e) => e.stopPropagation()}` to the `<OverlayFieldChip>` outer div. Click on chip now stays at the chip; click on PDF background still bubbles to main and deselects (preserves existing UX). Verified post-deploy: clicking the "Signed date" chip selected it (ring-2 outline + trash icon visible) and populated the inspector ("DATE FIELD · Page 5 · 159, 170 · 215×28pt · Font size 12"). Tour of editor shows v37 (was v15) — many auto-saves succeeded post-fix.

### Bug 4 — newly-dropped merge field blocks all auto-saves

**Surfaced in:** Same drop session as Bug 3. Header showed "Save error" persistently after a merge chip was dropped.

**Symptom:** Once any merge chip is dropped, every subsequent PATCH to `/api/settings/contract-templates/[id]` returns `400 invalid_overlay_fields`. The editor banner shows "Save error" and stays there until the offending merge field is given a `mergeFieldName` via the inspector — which Bug 3 prevented users from doing. Chicken-and-egg dead-end.

**Root cause:** `template-pdf-editor.tsx:107-128` `onPageDrop` constructs the new field with default geometry but only fills type-specific required props for `signature` (signerOrder), `input`/`checkbox` (inputKey + inputLabel), and `label` (labelText). It leaves `merge` fields with no `mergeFieldName`. `overlay-validation.ts:60-61` then rejects the field with `missing_required_property`, the route's PATCH responds 400 `invalid_overlay_fields`, and the route layer rolls back. So any merge chip locks saves until a name is assigned.

**Fix:** Same commit `2a2bc32` — default `mergeFieldName` to `MERGE_FIELDS[0].name` (`"customer_name"`) on drop. Field now passes validation immediately; author changes the name via the inspector dropdown. Verified post-deploy: editor shows two merge chips with `{{customer_name}}` and `{{property_address}}` resolved (Eric re-targeted the second one via inspector after fix went live). No "Save error" banner; template at v37.

## Test artifacts to clean up (Task 29)

_(populated as artifacts get created — template IDs, contract IDs, signer IDs, storage paths)_
