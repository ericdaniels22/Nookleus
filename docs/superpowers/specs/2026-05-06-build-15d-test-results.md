---
date: 2026-05-06
build_id: 15d
session_type: manual-test
related: ["[[build-15d]]", "[[2026-05-06-build-15d-implementation]]"]
spec: docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md
deploy_commit: 4208e54
---

# Build 15d — §11 Manual Test Pass Results

Tests run against Vercel deploy of `4208e54` (org: AAA prod / Test Co).

Legend: ✅ PASS · ❌ FAIL · ⏸ BLOCKED · ⏭ NOT YET RUN

## Summary

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Upload AAA FM-7001 PDF | ⏸ | Blocked on Bug 1 fix deploy (96eebeb) |
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

### 1. Upload AAA's FM-7001 PDF

**Spec:** Editor renders all 5 pages; page count badge shows "5 pages".

**Result:** _pending_

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

## Test artifacts to clean up (Task 29)

_(populated as artifacts get created — template IDs, contract IDs, signer IDs, storage paths)_
