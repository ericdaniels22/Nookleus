# Build 15e — Multi-Signer Next-Signer Email Handoff (plan)

Spec: [`2026-05-07-multi-signer-next-signer-email-handoff-design.md`](../specs/2026-05-07-multi-signer-next-signer-email-handoff-design.md)

## Single-file change

`src/app/api/sign/[token]/route.ts` — POST handler.

### Imports to add

```ts
import { generateSigningToken } from "@/lib/contracts/tokens";          // already partly imported (verifySigningToken, InvalidSigningTokenError)
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { computeInitialNextReminderAt } from "@/lib/contracts/reminders";
import type { ContractEmailSettings } from "@/lib/contracts/types";     // add to existing type import
```

Existing import line for `tokens` becomes:
`import { verifySigningToken, InvalidSigningTokenError, generateSigningToken } from "@/lib/contracts/tokens";`

### Local helper

Inline `appUrl()` mirroring the pattern in `/api/contracts/send/route.ts:29-32`. Place near the top of the file under the imports:

```ts
function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}
```

### Refactor the all-signed branch into an if/else

Current code (lines 203-254) is `if (allSigned && template.pdf_storage_path)`. Restructure to:

```ts
if (allSigned && template.pdf_storage_path) {
  // … existing PDF stamp + status flip block, unchanged …
} else if (!allSigned) {
  // NEW: next-signer email handoff (best-effort)
  try {
    const { data: settings } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", contract.organization_id)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    if (!settings) throw new Error("contract_email_settings row missing");

    const remaining = (refreshedSigners ?? [])
      .filter((s) => !s.signed_at)
      .sort((a, b) => a.signer_order - b.signer_order);
    const next = remaining[0];
    if (!next) throw new Error("no_next_signer_found");

    // refreshedSigners was a slim select — fetch full row for email + name
    const { data: nextRow } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("id", next.id)
      .maybeSingle<ContractSigner>();
    if (!nextRow) throw new Error("next signer row missing");

    const expiryDays = Math.max(1, Math.min(30, settings.default_link_expiry_days));
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const newToken = generateSigningToken({
      contractId: contract.id,
      signerId: nextRow.id,
      expiresAt,
    });

    const { error: actErr } = await supabase.rpc("activate_next_signer", {
      p_contract_id: contract.id,
      p_next_signer_id: nextRow.id,
      p_link_token: newToken,
      p_link_expires_at: expiresAt.toISOString(),
    });
    if (actErr) throw new Error(actErr.message);

    const { subject, html } = await resolveEmailTemplate(
      supabase,
      settings.signing_request_subject_template,
      settings.signing_request_body_template,
      contract.job_id,
      {
        signing_link: `${appUrl()}/sign/${newToken}`,
        document_title: contract.title,
      },
    );
    await sendContractEmail(supabase, settings, {
      to: nextRow.email,
      subject,
      html,
    });

    const firstReminder = computeInitialNextReminderAt(
      new Date(),
      settings.reminder_day_offsets,
    );
    if (firstReminder) {
      await supabase.rpc("schedule_first_reminder", {
        p_contract_id: contract.id,
        p_next_reminder_at: firstReminder.toISOString(),
      });
    }
  } catch (e) {
    await writeContractEvent(supabase, {
      contractId: contract.id,
      eventType: "email_delivered",
      metadata: {
        kind: "next_signer_activation",
        error: e instanceof Error ? e.message : String(e),
      },
    }).catch(() => undefined);
  }
}
```

The audit event at lines 256-266 (the `signed` event) and the final
`return NextResponse.json({ ok: true, all_signed: allSigned })` stay
exactly as they are, after this new block.

## Verification

1. `npx tsc --noEmit` (or whatever the project uses) — confirm types check.
2. ESLint pass on the touched file.
3. Visual diff review — confirm the existing all-signed block is byte-identical, only wrapped.

## Smoke test (gated)

End-to-end smoke requires Resend domain verification (see spec). When that's
ready, the test is:

1. Send a 2-signer contract from the SendContractModal in prod.
2. Signer 1 (test address A) opens the email, signs via the public link.
3. Within ~5s, signer 2 (test address B) should receive a "Sign your
   document" email with a working `/sign/<token>` link.
4. Signer 2 opens, signs.
5. Contract status flips to `signed`, signed PDF is generated.
6. Verify via Supabase MCP: `contract_events` table contains a row with
   `event_type = 'link_activated'` (from `activate_next_signer`) plus two
   `'signed'` rows.

If the email send fails (e.g. Resend domain still unverified), the audit
table will show `email_delivered` with `kind = next_signer_activation` and
the error message — the contract row will still show signer 1's signature
recorded but `link_token` will not have rotated and signer 2 won't have a
link.

## Rollback

Single commit. `git revert` is sufficient — no DB migrations.
