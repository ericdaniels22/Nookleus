import type { OverlayField } from "./types";

export interface AutoCheckboxEvaluation {
  // inputKey → ticked state. Only contains entries for checkbox overlay
  // fields with an `autoFillBinding` set. Caller merges these into the
  // contract's customer_inputs before persisting.
  inputs: Record<string, boolean>;
  // inputKeys whose bound merge field resolved to null/undefined. The
  // sender should see these as a warning before clicking send.
  unresolved: string[];
}

export function evaluateAutoCheckboxes(
  overlayFields: OverlayField[],
  resolvedValues: Record<string, string | null | undefined>,
): AutoCheckboxEvaluation {
  const inputs: Record<string, boolean> = {};
  const unresolved: string[] = [];

  for (const f of overlayFields) {
    if (f.type !== "checkbox") continue;
    if (!f.autoFillBinding) continue;
    if (!f.inputKey) continue;

    const { mergeFieldName, matchValues } = f.autoFillBinding;
    const value = resolvedValues[mergeFieldName];

    if (value === null || value === undefined || value === "") {
      inputs[f.inputKey] = false;
      unresolved.push(f.inputKey);
      continue;
    }

    inputs[f.inputKey] = matchValues.includes(value);
  }

  return { inputs, unresolved };
}
