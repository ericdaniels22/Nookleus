import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import {
  PhonePageClient,
  type PhoneConversationItem,
} from "./phone-page-client";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — Phone-tab two-pane UI.
//
// Server Component:
//   1. Gates on `view_phone`.
//   2. Side-loads the active org's conversations + each contact's name
//      + each contact's Active jobs in one server hop, then hands the
//      bundle to the client component.
//
// Empty state from slice 2 still renders when the org has no
// conversations yet — the client component shows it.

const ACTIVE_STATUSES = ["new", "in_progress", "pending_invoice"] as const;

export default async function PhonePage() {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePagePermission(supabase, {
    permission: "view_phone",
  });

  if (!auth.ok || !auth.orgId) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
          <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You don&apos;t have permission to view the Phone tab.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const orgId = auth.orgId;

  const { data: convoRows } = await supabase
    .from("phone_conversations")
    .select(
      "id, organization_id, phone_number_id, outside_e164, contact_id, last_event_at, unread_count, deleted_at",
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("last_event_at", { ascending: false });
  const conversations = (convoRows ?? []) as Array<{
    id: string;
    organization_id: string;
    phone_number_id: string;
    outside_e164: string;
    contact_id: string | null;
    last_event_at: string;
    unread_count: number;
  }>;

  const contactIds = Array.from(
    new Set(
      conversations
        .map((c) => c.contact_id)
        .filter((id): id is string => id !== null),
    ),
  );

  let contactsById: Record<string, { full_name: string }> = {};
  if (contactIds.length > 0) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, full_name")
      .in("id", contactIds);
    contactsById = Object.fromEntries(
      (contactRows ?? []).map((c) => [
        c.id as string,
        { full_name: c.full_name as string },
      ]),
    );
  }

  let activeJobsByContact: Record<string, Array<{ id: string; label: string }>> =
    {};
  if (contactIds.length > 0) {
    const { data: jobRows } = await supabase
      .from("jobs")
      .select("id, contact_id, status, job_number")
      .eq("organization_id", orgId)
      .in("contact_id", contactIds)
      .in("status", ACTIVE_STATUSES as unknown as string[]);
    activeJobsByContact = (jobRows ?? []).reduce<
      Record<string, Array<{ id: string; label: string }>>
    >((acc, j) => {
      const cid = j.contact_id as string;
      (acc[cid] ??= []).push({
        id: j.id as string,
        label: j.job_number as string,
      });
      return acc;
    }, {});
  }

  const items: PhoneConversationItem[] = conversations.map((c) => ({
    id: c.id,
    organization_id: c.organization_id,
    phone_number_id: c.phone_number_id,
    outside_e164: c.outside_e164,
    contact_id: c.contact_id,
    contact_name: c.contact_id
      ? contactsById[c.contact_id]?.full_name ?? null
      : null,
    last_event_at: c.last_event_at,
    unread_count: c.unread_count,
    active_jobs: c.contact_id ? activeJobsByContact[c.contact_id] ?? [] : [],
  }));

  return <PhonePageClient organizationId={orgId} initialConversations={items} />;
}
