import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sendContractReminder } from "@/lib/contracts/reminders";
import type { Contract, ContractSigner, ContractEmailSettings } from "@/lib/contracts/types";

// POST /api/contracts/[id]/remind
// Manual reminder trigger — the Remind button on sent/viewed contract
// rows. Fires a single reminder email to the currently active (unsigned)
// signer and records a 'reminder_sent' audit event. Intentionally does
// NOT shift contracts.next_reminder_at — the auto cron continues on its
// schedule. Reuses the configured reminder subject/body templates.
//
// Requires `edit_jobs` (#106) — contracts are gated on the job permissions.
// The Service client loads settings/contract/signers and sends the reminder.
export const POST = withRequestContext(
  { permission: "edit_jobs", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.serviceClient!;

    const { data: settings } = await supabase
      .from("contract_email_settings")
      .select("*")
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    if (!settings) {
      return NextResponse.json({ error: "Email settings missing" }, { status: 500 });
    }
    if (!settings.send_from_email || !settings.send_from_name) {
      return NextResponse.json(
        { error: "Set a send-from email and display name in Settings → Contracts." },
        { status: 400 },
      );
    }

    const { data: contract } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .maybeSingle<Contract>();
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (!["sent", "viewed"].includes(contract.status)) {
      return NextResponse.json(
        { error: "Only sent / viewed contracts can be reminded" },
        { status: 409 },
      );
    }

    const { data: signers } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract.id)
      .order("signer_order");
    if (!signers?.length) {
      return NextResponse.json({ error: "Contract has no signers" }, { status: 500 });
    }

    try {
      const result = await sendContractReminder(
        supabase,
        contract,
        signers as ContractSigner[],
        settings,
        { skipSchedule: true },
      );
      return NextResponse.json({ ok: true, sentTo: result.signerEmail });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  },
);
