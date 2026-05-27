// Lifetime-jobs rule. PRD #297 / slice C1 (#300).
//
// Encodes what "jobs attributed to a Referral Partner" means in one place:
// the FK matches AND the Job has not been trashed (`deleted_at IS NULL`).
// The list endpoint computes the count in SQL for the list page, but this
// module is the unit-tested specification of the count's meaning and is the
// keeper of the same rule for slice C2's Worksheet "Jobs sent" section.

export interface AttributableJob {
  referral_partner_id: string | null;
  deleted_at: string | null;
  created_at: string;
}

function isLiveAttribution<J extends AttributableJob>(
  job: J,
  partnerId: string,
): boolean {
  return job.referral_partner_id === partnerId && job.deleted_at === null;
}

export function countAttributed<J extends AttributableJob>(
  jobs: ReadonlyArray<J>,
  partnerId: string,
): number {
  let n = 0;
  for (const job of jobs) {
    if (isLiveAttribution(job, partnerId)) n += 1;
  }
  return n;
}

export function listAttributed<J extends AttributableJob>(
  jobs: ReadonlyArray<J>,
  partnerId: string,
): J[] {
  return jobs
    .filter((j) => isLiveAttribution(j, partnerId))
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
