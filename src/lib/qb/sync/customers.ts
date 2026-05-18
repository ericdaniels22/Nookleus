// Customer + sub-customer sync primitives. Both return a result the
// processor writes back into the log row.
//
// Dry-run: we assemble the full QB payload and return it (caller marks
// the log row skipped_dry_run with the payload). No QB API call.
//
// Live: we call QB, write back qb_entity_id onto contacts/jobs, and
// return the new QB id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { splitName } from "@/lib/contact-name";
import {
  createCustomer,
  getCustomer,
  updateCustomer,
} from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type {
  QbCustomerPayload,
  QbMappingRow,
  QbSyncAction,
} from "@/lib/qb/types";

export type SyncMode = "dry_run" | "live";

export interface SyncOutcome {
  status: "synced" | "skipped_dry_run" | "deferred";
  payload: QbCustomerPayload;
  qbEntityId?: string;
  // "deferred" = the row can't sync yet (parent customer missing) — the
  // processor leaves it queued for next tick.
  reason?: string;
}

export interface ContactRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  qb_customer_id: string | null;
}

export interface JobRow {
  id: string;
  contact_id: string;
  job_number: string;
  damage_type: string;
  property_address: string;
  qb_subcustomer_id: string | null;
}

export async function syncCustomer(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  contactId: string,
  action: QbSyncAction,
): Promise<SyncOutcome> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, phone, email, notes, qb_customer_id")
    .eq("id", contactId)
    .maybeSingle<ContactRow>();
  if (!contact) {
    throw new Error(`contacts row ${contactId} not found`);
  }

  const payload = buildCustomerPayload(contact);

  if (action === "update" && !contact.qb_customer_id) {
    // Shouldn't happen given the trigger's guards, but guard anyway.
    return { status: "skipped_dry_run", payload, reason: "no_qb_id_for_update" };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }

  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && contact.qb_customer_id) {
    // Fetch SyncToken from QB (required for sparse update).
    const current = await getCustomer(token, contact.qb_customer_id);
    if (!current) {
      // Record vanished on the QB side — fall through to re-create so we
      // at least get a new pointer. Rare but possible when an admin
      // deleted the customer in QB.
      const created = await createCustomer(token, payload);
      await supabase
        .from("contacts")
        .update({ qb_customer_id: created.id })
        .eq("id", contact.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updateCustomer(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (contact.qb_customer_id) {
    // Already synced. Nothing to create; treat as a no-op success.
    return { status: "synced", payload, qbEntityId: contact.qb_customer_id };
  }

  const created = await createCustomer(token, payload);
  await supabase
    .from("contacts")
    .update({ qb_customer_id: created.id })
    .eq("id", contact.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

export async function syncSubCustomer(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  jobId: string,
  action: QbSyncAction,
): Promise<SyncOutcome> {
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, contact_id, job_number, damage_type, property_address, qb_subcustomer_id",
    )
    .eq("id", jobId)
    .maybeSingle<JobRow>();
  if (!job) {
    throw new Error(`jobs row ${jobId} not found`);
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, phone, email, notes, qb_customer_id")
    .eq("id", job.contact_id)
    .maybeSingle<ContactRow>();
  if (!contact) {
    throw new Error(`contacts row ${job.contact_id} not found`);
  }

  // Parent must be synced before the sub-customer can exist in QB.
  // In dry-run we allow the payload to reference a placeholder so the log
  // row tells a complete story; in live mode we defer until the parent has
  // a qb_customer_id.
  if (!contact.qb_customer_id) {
    if (mode === "live") {
      return {
        status: "deferred",
        payload: buildSubCustomerPayload(job, contact, null, null),
        reason: "parent_customer_not_synced",
      };
    }
  }

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "damage_type");
  const classMap = (mappings ?? []) as QbMappingRow[];
  const classRef =
    classMap.find((m) => m.platform_value === job.damage_type) ?? null;

  const payload = buildSubCustomerPayload(
    job,
    contact,
    contact.qb_customer_id,
    classRef,
  );

  if (action === "update" && !job.qb_subcustomer_id) {
    return { status: "skipped_dry_run", payload, reason: "no_qb_id_for_update" };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }

  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && job.qb_subcustomer_id) {
    const current = await getCustomer(token, job.qb_subcustomer_id);
    if (!current) {
      const created = await createCustomer(token, payload);
      await supabase
        .from("jobs")
        .update({ qb_subcustomer_id: created.id })
        .eq("id", job.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updateCustomer(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (job.qb_subcustomer_id) {
    return { status: "synced", payload, qbEntityId: job.qb_subcustomer_id };
  }

  const created = await createCustomer(token, payload);
  await supabase
    .from("jobs")
    .update({ qb_subcustomer_id: created.id })
    .eq("id", job.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

// ---------- payload builders ----------

function displayName(fullName: string): string {
  const trimmed = (fullName ?? "").trim();
  return trimmed.length > 0 ? trimmed : "(no name)";
}

export function buildCustomerPayload(contact: ContactRow): QbCustomerPayload {
  // GivenName/FamilyName are derived from the single full_name with the
  // shared last-space split so QuickBooks' name fields stay populated.
  const { givenName, familyName } = splitName(contact.full_name);
  const payload: QbCustomerPayload = {
    DisplayName: displayName(contact.full_name),
    GivenName: givenName || undefined,
    FamilyName: familyName || undefined,
  };
  if (contact.phone) payload.PrimaryPhone = { FreeFormNumber: contact.phone };
  if (contact.email) payload.PrimaryEmailAddr = { Address: contact.email };
  if (contact.notes) payload.Notes = contact.notes;
  // BillAddr intentionally omitted on the parent customer — the contacts
  // table has no address fields. Sub-customers carry BillAddr instead.
  return payload;
}

export function buildSubCustomerPayload(
  job: JobRow,
  contact: ContactRow,
  parentQbId: string | null,
  classMapping: QbMappingRow | null,
): QbCustomerPayload {
  const { givenName, familyName } = splitName(contact.full_name);
  const subName = `${familyName || givenName || "Customer"}: ${job.job_number} - ${titleCase(job.damage_type)} Work`;
  const payload: QbCustomerPayload = {
    DisplayName: subName,
    Job: true,
  };
  if (parentQbId) payload.ParentRef = { value: parentQbId };
  if (job.property_address) {
    payload.BillAddr = { Line1: job.property_address };
  }
  if (classMapping) {
    payload.ClassRef = {
      value: classMapping.qb_entity_id,
      name: classMapping.qb_entity_name,
    };
  }
  return payload;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
