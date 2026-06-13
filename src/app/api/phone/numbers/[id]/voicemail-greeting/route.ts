import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import {
  validateVoicemailGreeting,
  uploadVoicemailGreeting,
  removeVoicemailGreeting,
  type VoicemailGreetingStorageClient,
} from "@/lib/phone/voicemail-greeting-storage";

// PRD #304 — Nookleus Phone. Slice 13 (#317) — set/clear a number's
// voicemail greeting.
//
//   PUT    /api/phone/numbers/[id]/voicemail-greeting  (multipart `file`)
//   DELETE /api/phone/numbers/[id]/voicemail-greeting
//
// Unlike the inbound_rule PATCH (Shared-only), a greeting applies to BOTH
// kinds: a Personal number's owner records their own; an admin records a
// Shared number's. The gate is canManage — Shared → admin; Personal →
// owner-self (or admin). Gate order mirrors the inbound-rule PATCH and the
// release route: look up the row with the Service client (RLS bypassed, the
// canManage check is the real gate), 404 a missing/cross-org row before
// learning anything about it, then canManage → 403.
//
// The audio is validated to mp3/wav (Twilio <Play> renders only those) and
// stored in the private `phone-voicemail-greetings` bucket. The column holds
// the storage PATH; the inbound-voice webhook mints a fresh signed URL per
// call, so no long-lived signed URL is ever persisted.

const PHONE_NUMBER_FIELDS =
  "id, organization_id, twilio_sid, e164, label, kind, user_id, inbound_rule, voicemail_greeting_url, monthly_cost_cents, is_active, released_at, created_at, updated_at";

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  kind: "shared" | "personal";
  user_id: string | null;
  voicemail_greeting_url: string | null;
}

// Shared gate: resolve the row and confirm the caller may manage it. Returns
// either the row (allowed) or a NextResponse to short-circuit (404/403).
async function loadManageable(
  ctx: Parameters<Parameters<typeof withRequestContext>[1]>[1],
  id: string,
): Promise<PhoneNumberRow | NextResponse> {
  const { data: row } = await ctx.serviceClient!
    .from("phone_numbers")
    .select("id, organization_id, kind, user_id, voicemail_greeting_url")
    .eq("id", id)
    .maybeSingle<PhoneNumberRow>();

  // Cross-org callers cannot prove the row exists → 404, same as a genuinely
  // missing row.
  if (!row || row.organization_id !== ctx.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = canManage(
    { userId: ctx.userId, organizationId: ctx.orgId ?? "", role: ctx.role },
    { kind: row.kind, organizationId: row.organization_id, userId: row.user_id },
  );
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  return row;
}

export const PUT = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const loaded = await loadManageable(ctx, id);
    if (loaded instanceof NextResponse) return loaded;
    const row = loaded;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validation = validateVoicemailGreeting({
      type: file.type,
      size: file.size,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    let storagePath: string;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stored = await uploadVoicemailGreeting(
        ctx.serviceClient as unknown as VoicemailGreetingStorageClient,
        {
          orgId: ctx.orgId!,
          numberId: id,
          ext: validation.ext,
          contentType: validation.contentType,
          bytes,
        },
      );
      storagePath = stored.storagePath;
    } catch (err) {
      const message = err instanceof Error ? err.message : "upload failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // A re-record at a different extension (wav → mp3) leaves the old object
    // orphaned; remove it best-effort so the bucket holds one greeting per
    // number. Never fail the request on cleanup.
    if (row.voicemail_greeting_url && row.voicemail_greeting_url !== storagePath) {
      try {
        await removeVoicemailGreeting(
          ctx.serviceClient as unknown as VoicemailGreetingStorageClient,
          row.voicemail_greeting_url,
        );
      } catch {
        /* best-effort: a stale object is harmless, a failed clear is not fatal */
      }
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .update({
        voicemail_greeting_url: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  },
);

export const DELETE = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const loaded = await loadManageable(ctx, id);
    if (loaded instanceof NextResponse) return loaded;
    const row = loaded;

    // Remove the audio object first (best-effort), then null the column so the
    // number falls back to the default spoken greeting.
    if (row.voicemail_greeting_url) {
      try {
        await removeVoicemailGreeting(
          ctx.serviceClient as unknown as VoicemailGreetingStorageClient,
          row.voicemail_greeting_url,
        );
      } catch {
        /* best-effort: clearing the column is what matters for playback */
      }
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .update({
        voicemail_greeting_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  },
);
