// Static badge palettes for job urgency and damage type. (Job-status colors and
// labels now come from useConfig() + src/lib/job-status-presentation.ts — the
// single source of truth per ADR 0022; #722 migrated the job-detail view off the
// old static status maps, so they no longer live here.)
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
