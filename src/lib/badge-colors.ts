// Job-status pipeline relabel (issue #720, ADR 0022): keys are frozen; only
// the display changes — New→Lead, In Progress→Active, Pending Invoice→
// Collections, Completed→Closed, Cancelled→Lost. Lost moves to a muted rose
// so it no longer looks identical to grey Closed. The canonical source of
// truth is src/lib/job-status-presentation.ts + the job_statuses rows; this
// static map is the job-detail hold-out kept in sync until #722 migrates it.
export const statusColors: Record<string, string> = {
  new: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
  in_progress: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
  pending_invoice: "bg-violet-100 text-violet-800 ring-1 ring-violet-200",
  completed: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
  cancelled: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
};

export const statusLabels: Record<string, string> = {
  new: "Lead",
  in_progress: "Active",
  pending_invoice: "Collections",
  completed: "Closed",
  cancelled: "Lost 😢",
};

export const urgencyColors: Record<string, string> = {
  emergency: "bg-red-100 text-red-800 ring-1 ring-red-300 font-semibold",
  urgent: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
  scheduled: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
};

export const urgencyLabels: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  scheduled: "Scheduled",
};

export const damageTypeColors: Record<string, string> = {
  water: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
  fire: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
  mold: "bg-lime-100 text-lime-800 ring-1 ring-lime-200",
  storm: "bg-violet-100 text-violet-800 ring-1 ring-violet-200",
  biohazard: "bg-red-100 text-red-800 ring-1 ring-red-200",
  contents: "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-200",
  rebuild: "bg-stone-100 text-stone-700 ring-1 ring-stone-200",
  other: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
};

export const damageTypeLabels: Record<string, string> = {
  water: "Water",
  fire: "Fire",
  mold: "Mold",
  storm: "Storm",
  biohazard: "Biohazard",
  contents: "Contents",
  rebuild: "Rebuild",
  other: "Other",
};
