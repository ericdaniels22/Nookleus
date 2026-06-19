// src/lib/job-status-presentation.ts
//
// Single source of truth for the CODE-SIDE facets of a Job status that the
// org-scoped `job_statuses` table cannot carry: the stage icon, the card
// left-stripe accent color, the pipeline sort rank, and the Open-vs-dead
// verdict — plus the default label and badge colors used as the pre-load
// fallback (and as the values the relabel migration seeds into the DB).
//
// The snake_case keys are FROZEN (ADR 0022). Only the DISPLAY changes: the
// lifecycle relabels to the pipeline Lead → Active → Collections → Closed →
// Lost. Any lifecycle logic must branch on the keys, never the labels.

import type { Job } from "@/lib/types";

export type JobStatusKey = Job["status"];

export interface JobStatusPresentation {
  /** Frozen snake_case status key (ADR 0022). */
  key: string;
  /** Default display label — the relabel migration seeds these into job_statuses.display_label. */
  label: string;
  /** lucide-react icon component name (same convention as damage_types.icon). */
  icon: string;
  /** Card left-stripe accent color (hex). */
  accentColor: string;
  /** Default badge colors — the pre-load fallback for getStatusColor and the migration source. */
  badge: { bg: string; text: string };
  /** Pipeline rank: Lead 1 → Active 2 → Collections 3 → Closed 4 → Lost 5. */
  sortRank: number;
  /** Open job stage? Lead/Active/Collections = true; Closed/Lost = false. */
  isOpen: boolean;
}

export const JOB_STATUS_PRESENTATION: Record<string, JobStatusPresentation> = {
  new: {
    key: "new",
    label: "Lead",
    icon: "Sprout",
    accentColor: "#C8841E",
    badge: { bg: "#FAEEDA", text: "#633806" },
    sortRank: 1,
    isOpen: true,
  },
  in_progress: {
    key: "in_progress",
    label: "Active",
    icon: "Hammer",
    accentColor: "#0E9F6E",
    badge: { bg: "#E1F5EE", text: "#085041" },
    sortRank: 2,
    isOpen: true,
  },
  pending_invoice: {
    key: "pending_invoice",
    label: "Collections",
    icon: "Banknote",
    accentColor: "#6E5BD6",
    badge: { bg: "#EEEDFE", text: "#3C3489" },
    sortRank: 3,
    isOpen: true,
  },
  completed: {
    key: "completed",
    label: "Closed",
    icon: "CheckCircle2",
    accentColor: "#9A988F",
    badge: { bg: "#F1EFE8", text: "#5F5E5A" },
    sortRank: 4,
    isOpen: false,
  },
  cancelled: {
    key: "cancelled",
    label: "Lost 😢",
    icon: "Frown",
    accentColor: "#E44B4A",
    badge: { bg: "#FBEAEA", text: "#9B2C2C" },
    sortRank: 5,
    isOpen: false,
  },
};

/** Presentation for an unknown key — renders the raw key, sorts last, counts as dead. */
function unknownPresentation(key: string): JobStatusPresentation {
  return {
    key,
    label: key,
    icon: "Circle",
    accentColor: "#9A988F",
    badge: { bg: "#F1EFE8", text: "#5F5E5A" },
    sortRank: 99,
    isOpen: false,
  };
}

/** Presentation facets for a status key, with a sensible fallback for unknown keys. */
export function getJobStatusPresentation(key: string): JobStatusPresentation {
  return JOB_STATUS_PRESENTATION[key] ?? unknownPresentation(key);
}

/** True when the status is an Open job stage (Lead / Active / Collections). */
export function isOpenJobStatus(key: string): boolean {
  return getJobStatusPresentation(key).isOpen;
}
