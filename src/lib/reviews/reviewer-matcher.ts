// Heuristically link a Google reviewer to a Contact (and that Contact's Job),
// to PRIVATELY inform an AI-drafted reply. A Google review carries only the
// reviewer's display name, so the only signal is a case-insensitive full-name
// match. The result is drafting context only — the public reply must never
// assert the match (#608 AC2). Pure: callers pre-load the cache.

export interface ReviewerContactRow {
  id: string;
  full_name: string;
}

export interface ReviewerJobRow {
  id: string;
  job_number: string;
  property_address: string | null;
  contact_id: string;
}

export interface ReviewerMatcherCache {
  contacts: ReviewerContactRow[];
  jobs: ReviewerJobRow[];
}

export interface ReviewerMatch {
  contact_id: string;
  contact_name: string;
  job: {
    id: string;
    job_number: string;
    property_address: string | null;
  } | null;
}

export function matchReviewerToContext(
  cache: ReviewerMatcherCache,
  reviewerName: string | null,
): ReviewerMatch | null {
  const name = reviewerName?.trim().toLowerCase() ?? "";
  if (!name) return null; // anonymous reviewer — never match anything

  const contact = cache.contacts.find(
    (c) => c.full_name.trim().toLowerCase() === name,
  );
  if (!contact) return null;

  const job = cache.jobs.find((j) => j.contact_id === contact.id) ?? null;

  return {
    contact_id: contact.id,
    contact_name: contact.full_name,
    job: job
      ? {
          id: job.id,
          job_number: job.job_number,
          property_address: job.property_address,
        }
      : null,
  };
}
