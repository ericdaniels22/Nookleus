// Pure logic behind the active-Job picker (issue #701) — the search a worker
// uses to find the Job to clock into. No Supabase, no React: it takes the
// candidate (Active) Jobs the picker loaded plus the worker's recently-clocked
// Job ids and returns the filtered, ranked list to render.
//
// A narrow input shape (id, job_number, property_address, optional contact)
// rather than the full Job type — a real Job satisfies it structurally, and
// tests stay readable.

export interface PickerJob {
  id: string;
  job_number: string;
  property_address: string;
  contact?: { full_name: string } | null;
}

export interface RankPickerJobsOptions {
  /** Raw text typed into the picker's search box. */
  query: string;
  /** The worker's own Job ids, most-recently-clocked first. */
  recentJobIds: string[];
}

export function rankPickerJobs(
  jobs: PickerJob[],
  { query, recentJobIds }: RankPickerJobsOptions,
): PickerJob[] {
  const needle = query.trim().toLowerCase();
  const matches = jobs.filter((job) => {
    const haystacks = [
      job.property_address,
      job.contact?.full_name ?? "",
      job.job_number,
    ];
    return haystacks.some((field) => field.toLowerCase().includes(needle));
  });

  // Recently-clocked Jobs lead, in recency order; everything else keeps its
  // input order behind them. Array.prototype.sort is stable, so a constant
  // rank for the never-clocked tail preserves their relative order.
  const rankOf = (job: PickerJob) => {
    const i = recentJobIds.indexOf(job.id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return matches.slice().sort((a, b) => rankOf(a) - rankOf(b));
}
