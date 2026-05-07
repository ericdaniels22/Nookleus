import type { OverlayField, PdfPage } from "./types";
import { MERGE_FIELDS } from "./merge-fields";

export interface ValidationError {
  fieldId: string | null;
  code:
    | "duplicate_id"
    | "duplicate_input_key"
    | "page_out_of_range"
    | "out_of_bounds"
    | "unknown_merge_field"
    | "missing_required_property"
    | "invalid_signer_order"
    | "invalid_input_key";
  message: string;
}

const INPUT_KEY_RE = /^[a-z0-9_-]+$/;

export function validateOverlayFields(
  fields: OverlayField[],
  pdfPages: PdfPage[] | null,
  signerCount: 1 | 2,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const seenInputKeys = new Set<string>();
  const knownMergeNames = new Set(MERGE_FIELDS.map((m) => m.name));

  for (const f of fields) {
    if (seenIds.has(f.id)) {
      errors.push({ fieldId: f.id, code: "duplicate_id", message: `Duplicate field id: ${f.id}` });
    }
    seenIds.add(f.id);

    if (pdfPages) {
      const meta = pdfPages.find((p) => p.page === f.page);
      if (!meta) {
        errors.push({
          fieldId: f.id,
          code: "page_out_of_range",
          message: `Page ${f.page} is out of range`,
        });
      } else if (
        f.x < 0 ||
        f.y < 0 ||
        f.x + f.width > meta.width_pt + 1 ||
        f.y + f.height > meta.height_pt + 1
      ) {
        errors.push({
          fieldId: f.id,
          code: "out_of_bounds",
          message: `Field overflows page ${f.page}`,
        });
      }
    }

    switch (f.type) {
      case "merge":
        if (!f.mergeFieldName) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "merge field missing mergeFieldName" });
        } else if (!knownMergeNames.has(f.mergeFieldName)) {
          errors.push({ fieldId: f.id, code: "unknown_merge_field", message: `Unknown merge field: ${f.mergeFieldName}` });
        }
        break;
      case "label":
        if (!f.labelText) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "label field missing labelText" });
        }
        break;
      case "signature":
        if (f.signerOrder !== 1 && f.signerOrder !== 2) {
          errors.push({ fieldId: f.id, code: "invalid_signer_order", message: "signature field requires signerOrder 1 or 2" });
        } else if (f.signerOrder > signerCount) {
          errors.push({
            fieldId: f.id,
            code: "invalid_signer_order",
            message: `signerOrder ${f.signerOrder} exceeds template signer_count ${signerCount}`,
          });
        }
        break;
      case "input":
      case "checkbox":
        if (!f.inputKey || !INPUT_KEY_RE.test(f.inputKey)) {
          errors.push({ fieldId: f.id, code: "invalid_input_key", message: `Invalid inputKey: ${f.inputKey ?? ""}` });
        } else if (seenInputKeys.has(f.inputKey)) {
          errors.push({ fieldId: f.id, code: "duplicate_input_key", message: `Duplicate inputKey: ${f.inputKey}` });
        } else {
          seenInputKeys.add(f.inputKey);
        }
        if (f.required && !f.inputLabel) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "required input/checkbox needs inputLabel" });
        }
        break;
    }
  }

  return errors;
}

export function clampToPage(field: OverlayField, page: PdfPage): OverlayField {
  const w = Math.min(field.width, page.width_pt);
  const h = Math.min(field.height, page.height_pt);
  const x = Math.max(0, Math.min(field.x, page.width_pt - w));
  const y = Math.max(0, Math.min(field.y, page.height_pt - h));
  return { ...field, x, y, width: w, height: h };
}
