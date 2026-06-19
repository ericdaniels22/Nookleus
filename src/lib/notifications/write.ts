import { createServiceClient } from "@/lib/supabase-api";
import type { NotificationRow } from "@/lib/payments/types";

export type NotificationType = NotificationRow["type"];

export interface WriteNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  jobId?: string | null;
  metadata?: Record<string, unknown>;
  // If provided, notify only this user. Default: fan out per `audience`.
  userId?: string | null;
  // Who the fan-out reaches (ignored when `userId` is set):
  //   "admins"  — active admins only (default; preserves the original behavior)
  //   "members" — every active member of the org, any role (e.g. new-intake)
  audience?: "admins" | "members";
  // When fanning out, omit this user — e.g. the submitter who triggered the
  // event and need not be told of their own action. See ADR 0018.
  excludeUserId?: string | null;
  // Org scope for the notification row(s). Required — writeNotification uses a
  // service client, so it cannot resolve the active org from a session JWT.
  // Callers in webhook context source this from the row they're reacting to
  // (e.g. `payment.organization_id`); callers in request context source it
  // via `getActiveOrganizationId(supabase)` at the call site.
  organizationId: string;
}

/**
 * Write the notification row(s) and return the user ids actually notified — the
 * single source of truth for "who got told". A best-effort follow-on (e.g. the
 * new-intake push fan-out in #673) reuses this exact set so the audience can't
 * drift between the in-app bell and the buzz.
 */
export async function writeNotification(
  input: WriteNotificationInput,
): Promise<string[]> {
  const supabase = createServiceClient();
  const orgId = input.organizationId;

  const row = {
    organization_id: orgId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    priority: input.priority ?? "normal",
    job_id: input.jobId ?? null,
    metadata: input.metadata ?? {},
  };

  if (input.userId) {
    const { error } = await supabase
      .from("notifications")
      .insert({ ...row, user_id: input.userId });
    if (error) throw new Error(`notifications insert: ${error.message}`);
    return [input.userId];
  }

  // Fan out: one row per active member of this org. Role lives on
  // user_organizations; joined through user_profiles for the is_active filter.
  // "admins" keeps the role gate; "members" reaches every active member.
  let query = supabase
    .from("user_organizations")
    .select("user_id, user_profiles:user_id(is_active)")
    .eq("organization_id", orgId);
  if ((input.audience ?? "admins") === "admins") {
    query = query.eq("role", "admin");
  }
  const { data: members, error: membersErr } = await query;
  if (membersErr) throw new Error(`member lookup: ${membersErr.message}`);

  const recipientIds = (members ?? [])
    .filter((m) => {
      const profile = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
      return profile?.is_active === true;
    })
    .map((m) => m.user_id)
    .filter((userId) => userId !== input.excludeUserId);

  if (recipientIds.length === 0) return [];

  const rows = recipientIds.map((userId: string) => ({ ...row, user_id: userId }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw new Error(`notifications bulk insert: ${error.message}`);
  return recipientIds;
}
