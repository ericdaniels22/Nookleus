// `belongsToActiveOrganization` — the tenant-scoping guard for Service-client
// routes.
//
// A User-client route gets tenant isolation for free: row-level security
// makes the database itself refuse a cross-Organization read. A Service-client
// route does not — the Service client bypasses RLS — so the route is
// responsible for the scoping check the database would otherwise do.
//
// This module is that check, in one place. Given a resource locator and the
// caller's Active Organization, it answers a single boolean question: does
// this resource belong to that Organization? A route calls it and, when the
// answer is false, returns 404 — never 403: a resource in another
// Organization must be indistinguishable from one that does not exist, so the
// guard never confirms a foreign resource's existence.
//
// See CONTEXT.md for Organization / Active Organization / Service client.

import type { SupabaseClient } from "@supabase/supabase-js";

// How a resource is identified. Either directly — a row in a named table — or
// by the job it belongs to (`{ jobId }`), the locator most Service-client
// routes have at hand. `{ jobId }` is shorthand for `{ table: "jobs", id }`.
export type ResourceLocator =
  | { table: string; id: string }
  | { jobId: string };

// Resolves a resource id to the Organization that owns it, or null when the
// resource — or any row in its resolution chain — does not exist. One per
// table the guard knows how to scope; see RESOLVERS.
type OrgResolver = (
  client: SupabaseClient,
  id: string,
) => Promise<string | null>;

// A table that carries its own `organization_id` column: the Organization is
// one read away.
function directColumn(table: string): OrgResolver {
  return async (client, id) => {
    const { data } = await client
      .from(table)
      .select("organization_id")
      .eq("id", id)
      .maybeSingle<{ organization_id: string | null }>();
    return data?.organization_id ?? null;
  };
}

// A table with no `organization_id` of its own that reaches an Organization
// through a foreign key into a table that does (e.g. job_activities -> jobs).
// The chain is followed by delegating to the target table's resolver, so an
// indirection of any depth composes from one-step links.
function throughForeignKey(
  table: string,
  foreignKey: string,
  target: OrgResolver,
): OrgResolver {
  return async (client, id) => {
    const { data } = await client
      .from(table)
      .select(foreignKey)
      .eq("id", id)
      .maybeSingle<Record<string, string | null>>();
    const targetId = data?.[foreignKey];
    if (!targetId) return null;
    return target(client, targetId);
  };
}

const resolveJobOrg = directColumn("jobs");

// Every table the guard can scope, and how. A table absent from this map is a
// deliberate gap, not a silent pass: `belongsToActiveOrganization` throws
// rather than guess, so wiring up a Service-client consumer is a conscious act
// of registering its table here.
const RESOLVERS: Record<string, OrgResolver> = {
  jobs: resolveJobOrg,
  job_activities: throughForeignKey("job_activities", "job_id", resolveJobOrg),
};

/**
 * Answers whether the located resource belongs to the given Active
 * Organization.
 *
 * Returns false when the resource does not exist, when it belongs to another
 * Organization, or when `activeOrgId` is null (no Active Organization owns
 * anything) — the caller treats all three the same: a 404.
 *
 * Throws when asked about a table with no registered resolver — an
 * unrecognized table is a programming error, never a quiet allow.
 */
export async function belongsToActiveOrganization(
  client: SupabaseClient,
  locator: ResourceLocator,
  activeOrgId: string | null,
): Promise<boolean> {
  if (!activeOrgId) return false;

  const { table, id } =
    "jobId" in locator
      ? { table: "jobs", id: locator.jobId }
      : locator;

  const resolver = RESOLVERS[table];
  if (!resolver) {
    throw new Error(
      `belongsToActiveOrganization: no Organization resolver registered for table "${table}"`,
    );
  }

  const resourceOrgId = await resolver(client, id);
  return resourceOrgId === activeOrgId;
}
