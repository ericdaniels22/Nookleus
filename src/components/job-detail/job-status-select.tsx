"use client";

import { useConfig } from "@/lib/config-context";
import { getJobStatusOptions } from "@/lib/job-status-presentation";

interface JobStatusSelectProps {
  /** The Job's current status key (frozen snake_case). */
  value: string;
  /** Called with the newly-selected status key. */
  onChange: (next: string) => void;
  className?: string;
}

/**
 * Job-detail status picker (#722).
 *
 * Reads the five lifecycle stages from config — getJobStatusOptions overlays
 * the org's per-status display_label onto the canonical pipeline order — so the
 * picker shows Lead / Active / Collections / Closed / Lost, reflects a per-org
 * rename with no code change, and never drifts from the badges shown elsewhere.
 * Selecting a stage calls onChange with the frozen status key.
 */
export function JobStatusSelect({
  value,
  onChange,
  className,
}: JobStatusSelectProps) {
  const { statuses } = useConfig();
  const options = getJobStatusOptions(statuses);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
