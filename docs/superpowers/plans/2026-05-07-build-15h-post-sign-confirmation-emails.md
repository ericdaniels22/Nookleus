# Build 15h — Post-Sign Confirmation Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send customer + internal confirmation emails (with the signed PDF attached) when all signers have signed, on both the public-link and in-person signing flows. Then delete ~1,260 lines of orphan code from 15d's carve-out.

**Architecture:** Extract a single shared `finalizeSignedContract` helper in `src/lib/contracts/finalize.ts` that owns the post-final-signer pipeline (stamp → upload → status flip → customer emails → internal email → audit rows). Both `POST /api/sign/[token]` and `POST /api/contracts/in-person` collapse their inlined ~60-line stamp blocks into a single helper call. After the new flow is verified end-to-end against AAA prod, delete the three orphan files (`sign/route.ts`, `regenerate-pdf/route.ts`, `pdf.ts`) plus the dead `pdfjs` postinstall step.

**Tech Stack:** TypeScript, Next.js 16 App Router, Supabase service-role client, Resend (`sendContractEmail` router), `pdf-lib` for stamping, `contract_events` audit table.

**Project conventions:** No unit-test framework is configured in this repo. Verification gates per task are: `npx tsc --noEmit`, `npm run build`, then live smoke against AAA prod (matching the §11 manual test pattern from 15d/15e).

**Spec:** `docs/superpowers/specs/2026-05-07-build-15h-post-sign-confirmation-emails-design.md`

**Mechanical state at start:**
- Branch: `main`
- HEAD at start of work: `71f6aed` (the spec commit) on top of `14edb05` (PR #49 zoom controls)

---

## File map

**Create:**
- `src/lib/contracts/finalize.ts` — `finalizeSignedContract` helper. Single export.

**Modify:**
- `src/app/api/sign/[token]/route.ts` — collapse the `allSigned` block (lines 217–268 of the current file) into a `finalizeSignedContract(...)` call.
- `src/app/api/contracts/in-person/route.ts` — collapse the `allSigned` block (lines 115–169 of the current file) into a `finalizeSignedContract(...)` call.
- `package.json` — drop the `postinstall` script that copies `pdf.worker.min.mjs` to `/public/`.

**Delete:**
- `src/app/api/contracts/[id]/sign/route.ts` (475 lines, no callers)
- `src/app/api/contracts/[id]/regenerate-pdf/route.ts` (100 lines, no callers)
- `src/lib/contracts/pdf.ts` (685 lines, only consumed by the two orphan routes above)
- `public/pdf.worker.min.mjs` (artifact of the now-dead postinstall step; bundler-resolved version is used since 15e)

---

## Task 1: Pre-flight DB verification

No code changes. Confirm the `contract_email_settings` row for AAA (and ideally Test Co) has non-empty values for all four signed-confirmation template columns. The seed migration that originally populated these is `build15b_contract_email_settings_seed`-era; 15e's runtime UPDATE only touched from/reply addresses, but a stale env or hand-edit could have left a column empty.

**Files:** none modified.

- [ ] **Step 1: Run pre-flight SQL via Supabase MCP**

Use `mcp__claude_ai_Supabase__execute_sql` against the prod project (`rzzprgidqbnqcdupmpfe`) with this query:

```sql
SELECT
  o.id AS organization_id,
  o.name AS org_name,
  s.send_from_email,
  s.reply_to_email,
  s.provider,
  length(s.signed_confirmation_subject_template) > 0 AS has_cust_subj,
  length(s.signed_confirmation_body_template) > 0 AS has_cust_body,
  length(s.signed_confirmation_internal_subject_template) > 0 AS has_int_subj,
  length(s.signed_confirmation_internal_body_template) > 0 AS has_int_body
FROM contract_email_settings s
JOIN organizations o ON o.id = s.organization_id
ORDER BY o.name;
```

Expected: at least the AAA row (`AAA Disaster Recovery` or similar) is present with `provider = 'resend'`, `send_from_email = 'noreply@aaadisasterrecovery.com'`, `reply_to_email = 'eric@aaacontracting.com'`, and all four `has_*` flags `true`.

- [ ] **Step 2: If any flag is false, fix at runtime via Supabase MCP**

If any `has_*` flag returns false (column is empty), populate it. Reference template strings live in the legacy orphan route at `src/app/api/contracts/[id]/sign/route.ts` lines 372–458 and in the seed migration. For AAA, reasonable defaults if a column is empty:

- `signed_confirmation_subject_template` = `Your signed copy of {{document_title}}`
- `signed_confirmation_body_template` = `<p>Hi {{customer_first_name}},</p><p>Thanks — your copy of <strong>{{document_title}}</strong> is attached.</p><p>— {{company_name}}</p>`
- `signed_confirmation_internal_subject_template` = `Signed: {{document_title}} ({{customer_name}})`
- `signed_confirmation_internal_body_template` = `<p>{{customer_name}} just signed <strong>{{document_title}}</strong>.</p><p>View on the platform: <a href="{{contract_platform_url}}">{{contract_platform_url}}</a></p>`

Apply with:

```sql
UPDATE contract_email_settings
SET signed_confirmation_subject_template = '<...>'
WHERE organization_id = '<AAA org id>'
  AND length(signed_confirmation_subject_template) = 0;
```

(Repeat per empty column.) Then re-run Step 1's SELECT to confirm all flags are true.

- [ ] **Step 3: Record pre-flight result**

Capture the SELECT output verbatim in the eventual handoff doc. No commit. Move to Task 2.

---

## Task 2: Create `finalizeSignedContract` helper

Adds the new helper file. No callers yet — pure addition. Commits independently so a regression in Task 3 can be reverted without losing the helper.

**Files:**
- Create: `src/lib/contracts/finalize.ts`

- [ ] **Step 1: Create the file with the full helper**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeContractEvent } from "./audit";
import { resolveMergeValues } from "./resolve-merge-values";
import { resolveEmailTemplate } from "./email-merge-fields";
import { sendContractEmail, resolveInternalRecipient } from "./email";
import { stampPdf } from "./stamp-pdf";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  ContractEmailSettings,
} from "./types";

export interface FinalizeArgs {
  supabase: SupabaseClient;
  contract: Contract;
  template: ContractTemplate;
  signers: ContractSigner[];           // ordered by signer_order, all signed
  customerInputs: Record<string, string | boolean>;
  signedAt: Date;
}

export interface FinalizeResult {
  signedPdfPath: string;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_");
}

// Owns the post-final-signer pipeline:
//   1. download signature PNGs + source template PDF
//   2. resolve merge values + stamp the PDF
//   3. upload stamped PDF + flip contracts.status to 'signed'
//   4. dispatch one customer confirmation email per signer (best-effort)
//   5. dispatch one internal confirmation email (best-effort)
//   6. write success/failure audit rows for every email send
//
// The signing operation is "done" once the status flip in step 3 lands.
// Steps 4–6 are best-effort: failures write an `email_delivered` audit
// row with `error: <message>` and do not throw out of finalize.
export async function finalizeSignedContract(
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const { supabase, contract, template, signers, customerInputs, signedAt } = args;

  // --- Stamp pipeline ---------------------------------------------------
  if (!template.pdf_storage_path) {
    throw new Error("finalizeSignedContract: template.pdf_storage_path is null");
  }

  const dataUrlsBySignerId: Record<string, string> = {};
  const orderById: Record<string, 1 | 2> = {};
  for (const s of signers) {
    if (!s.signature_image_path) continue;
    const { data: blob, error } = await supabase.storage
      .from("contract-pdfs")
      .download(s.signature_image_path);
    if (error || !blob) {
      throw new Error(
        `finalizeSignedContract: failed to download signature for signer ${s.id}: ${error?.message ?? "missing"}`,
      );
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    const b64 = Buffer.from(buf).toString("base64");
    dataUrlsBySignerId[s.id] = `data:image/png;base64,${b64}`;
    orderById[s.id] = s.signer_order;
  }

  const { data: srcBlob, error: srcErr } = await supabase.storage
    .from("contract-pdfs")
    .download(template.pdf_storage_path);
  if (srcErr || !srcBlob) {
    throw new Error(
      `finalizeSignedContract: failed to download source PDF: ${srcErr?.message ?? "missing"}`,
    );
  }
  const srcBytes = new Uint8Array(await srcBlob.arrayBuffer());

  const resolved = await resolveMergeValues(supabase, contract.job_id, { signedAt });
  const stamped = await stampPdf({
    sourcePdfBytes: srcBytes,
    pdfPages: template.pdf_pages ?? [],
    overlayFields: template.overlay_fields,
    resolvedMergeValues: resolved,
    customerInputs,
    signatureDataUrls: dataUrlsBySignerId,
    signerOrderById: orderById,
    signedAt,
  });

  const stampedPath = `${contract.organization_id}/contracts/${contract.id}-signed.pdf`;
  const { error: stampedUploadErr } = await supabase.storage
    .from("contract-pdfs")
    .upload(stampedPath, stamped, { contentType: "application/pdf", upsert: true });
  if (stampedUploadErr) {
    throw new Error(
      `finalizeSignedContract: stamped PDF upload failed: ${stampedUploadErr.message}`,
    );
  }

  await supabase
    .from("contracts")
    .update({
      status: "signed",
      signed_pdf_path: stampedPath,
      signed_at: signedAt.toISOString(),
    })
    .eq("id", contract.id);

  // --- Email dispatch (best-effort) ------------------------------------
  // Wrap everything below in a single try; any uncaught throw lands as
  // one audit row noting the failure. Per-email try/catch below isolates
  // each send so one bad address does not block the others.
  try {
    const { data: settings } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", contract.organization_id)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();

    if (!settings) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "customer_confirmation",
          error: "contract_email_settings row missing",
        },
      }).catch(() => undefined);
      return { signedPdfPath: stampedPath };
    }

    const pdfAttachment = {
      filename: `${sanitizeForFilename(contract.title)}.pdf`,
      content: Buffer.from(stamped),
      contentType: "application/pdf",
    };

    // --- Customer confirmation, one per signer -------------------------
    for (const s of signers) {
      try {
        const { subject, html } = await resolveEmailTemplate(
          supabase,
          settings.signed_confirmation_subject_template,
          settings.signed_confirmation_body_template,
          contract.job_id,
          { signing_link: "", document_title: contract.title },
        );
        const result = await sendContractEmail(supabase, settings, {
          to: s.email,
          subject,
          html,
          attachments: [pdfAttachment],
        });
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          signerId: s.id,
          metadata: {
            kind: "customer_confirmation",
            signer_id: s.id,
            provider: result.provider,
            message_id: result.messageId,
          },
        });
      } catch (e) {
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          signerId: s.id,
          metadata: {
            kind: "customer_confirmation",
            signer_id: s.id,
            error: e instanceof Error ? e.message : String(e),
          },
        }).catch(() => undefined);
      }
    }

    // --- Internal confirmation -----------------------------------------
    try {
      let internalAddress: string | null = null;
      if (settings.provider === "email_account" && settings.email_account_id) {
        const { data: acct } = await supabase
          .from("email_accounts")
          .select("email_address")
          .eq("id", settings.email_account_id)
          .maybeSingle<{ email_address: string }>();
        internalAddress = acct?.email_address ?? null;
      }
      const internalTo = resolveInternalRecipient(settings, internalAddress);
      if (internalTo) {
        const { subject, html } = await resolveEmailTemplate(
          supabase,
          settings.signed_confirmation_internal_subject_template,
          settings.signed_confirmation_internal_body_template,
          contract.job_id,
          {
            signing_link: "",
            document_title: contract.title,
            contract_platform_url: `${appUrl()}/jobs/${contract.job_id}`,
          },
        );
        const result = await sendContractEmail(supabase, settings, {
          to: internalTo,
          subject,
          html,
          attachments: [pdfAttachment],
        });
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          metadata: {
            kind: "internal_confirmation",
            provider: result.provider,
            message_id: result.messageId,
          },
        });
      }
    } catch (e) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "internal_confirmation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
    }
  } catch (e) {
    // Outer guard: anything not caught above (e.g. settings query throws)
    // becomes a single audit row. Status flip is already committed.
    await writeContractEvent(supabase, {
      contractId: contract.id,
      eventType: "email_delivered",
      metadata: {
        kind: "customer_confirmation",
        error: `finalize email dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    }).catch(() => undefined);
  }

  return { signedPdfPath: stampedPath };
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors. The helper imports only existing modules; type signatures match `Contract`, `ContractTemplate`, `ContractSigner`, `ContractEmailSettings` from `./types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/contracts/finalize.ts
git commit -m "$(cat <<'EOF'
feat(15h): add finalizeSignedContract helper

New helper at src/lib/contracts/finalize.ts that owns the post-final-
signer pipeline: stamp + upload + status flip + customer confirmation
emails (one per signer) + internal confirmation email + audit rows.
Not yet called by anyone — wired in next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate both signing routes to use the helper

Single commit: both `POST /api/sign/[token]` and `POST /api/contracts/in-person` are rewritten to call `finalizeSignedContract` in their `allSigned` branch. The two routes change in lockstep so the spec's symmetry guarantee holds.

**Files:**
- Modify: `src/app/api/sign/[token]/route.ts` — replace lines 217–268 (the inlined stamp block) with a helper call. Reload the full signers + template after the per-signer DB updates so the helper gets fresh rows.
- Modify: `src/app/api/contracts/in-person/route.ts` — replace lines 115–169 with the same pattern.

- [ ] **Step 1: Update `src/app/api/sign/[token]/route.ts`**

The current `allSigned` block reloads signers via a partial SELECT (only `id, signer_order, signed_at, signature_image_path`). The helper needs the full `ContractSigner` rows (it reads `email`). Refactor so the post-update reload selects `*`.

Replace the imports section (top of file) — remove `resolveMergeValues` and `stampPdf`, add `finalizeSignedContract`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifySigningToken,
  InvalidSigningTokenError,
  generateSigningToken,
} from "@/lib/contracts/tokens";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { computeInitialNextReminderAt } from "@/lib/contracts/reminders";
import { finalizeSignedContract } from "@/lib/contracts/finalize";
import { buildPublicSigningViewByToken, type BuildViewError } from "@/lib/contracts/build-public-signing-view";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  ContractEmailSettings,
} from "@/lib/contracts/types";
```

Replace the post-signer-update reload (currently at line 211–215, selecting partial columns):

```ts
const { data: refreshedSigners } = await supabase
  .from("contract_signers")
  .select("id, signer_order, signed_at, signature_image_path")
  .eq("contract_id", contract.id);
const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);
```

with:

```ts
const { data: refreshedSigners } = await supabase
  .from("contract_signers")
  .select("*")
  .eq("contract_id", contract.id)
  .order("signer_order");
const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);
```

Then replace the entire `if (allSigned && template.pdf_storage_path) { ... }` block (lines 217–268 of the original file — the stamp pipeline) with this single helper call:

```ts
if (allSigned && template.pdf_storage_path) {
  await finalizeSignedContract({
    supabase,
    contract,
    template,
    signers: (refreshedSigners ?? []) as ContractSigner[],
    customerInputs: mergedInputs,
    signedAt,
  });
}
```

Leave the entire `if (!allSigned) { ... }` next-signer-handoff block (the 15e logic) untouched. Leave the trailing `signed` audit-event write untouched.

- [ ] **Step 2: Update `src/app/api/contracts/in-person/route.ts`**

Same pattern. Imports — remove `resolveMergeValues` and `stampPdf`, add `finalizeSignedContract`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { finalizeSignedContract } from "@/lib/contracts/finalize";
import type { Contract, ContractSigner, ContractTemplate } from "@/lib/contracts/types";
```

Replace the post-signer-update reload (currently at line 109–113):

```ts
const { data: refreshedSigners } = await supabase
  .from("contract_signers")
  .select("id, signer_order, signed_at, signature_image_path")
  .eq("contract_id", contract.id);
const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);
```

with:

```ts
const { data: refreshedSigners } = await supabase
  .from("contract_signers")
  .select("*")
  .eq("contract_id", contract.id)
  .order("signer_order");
const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);
```

Then replace the entire `if (allSigned && template.pdf_storage_path) { ... }` block (lines 115–169) with:

```ts
if (allSigned && template.pdf_storage_path) {
  await finalizeSignedContract({
    supabase,
    contract,
    template,
    signers: (refreshedSigners ?? []) as ContractSigner[],
    customerInputs: mergedInputs,
    signedAt,
  });
}
```

Leave the trailing `signed` audit-event write untouched.

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors. Possible warning: unused imports (`resolveMergeValues`, `stampPdf`) if you missed any in step 1 or 2 — remove if so.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: `✓ Compiled successfully`. If it fails on the signing routes, re-check imports and the helper-call shape.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sign/\[token\]/route.ts src/app/api/contracts/in-person/route.ts
git commit -m "$(cat <<'EOF'
feat(15h): wire both signing routes to finalizeSignedContract

Both POST /api/sign/[token] and POST /api/contracts/in-person now call
finalizeSignedContract in their allSigned branch. The helper owns the
stamp pipeline + customer/internal confirmation emails + audit rows.
~50 lines of duplicated stamp-pipeline code removed from each route.

Routes still own their own auth, validation, signer-row update, and the
post-finalize 'signed' audit event. The 15e next-signer-handoff branch
in /api/sign/[token] is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push to origin/main**

Run: `git push origin main`
Expected: fast-forward push succeeds. Vercel auto-deploys; takes ~2 min to go live.

---

## Task 4: Verify the deploy went live

Confirm the Vercel deploy is the new code before running smoke tests.

**Files:** none modified.

- [ ] **Step 1: Wait for Vercel deploy**

Either watch the Vercel dashboard or poll the production URL:

```bash
curl -sI https://aaaplatform.vercel.app/login | grep -iE 'etag|x-vercel-id|x-matched-path'
```

Re-run until the etag changes from whatever the value was before the push. ~2 minutes is typical.

- [ ] **Step 2: Spot-check a public route still returns 200**

```bash
curl -sI https://aaaplatform.vercel.app/login | head -1
```

Expected: `HTTP/2 200`. Anything else means the deploy failed — investigate Vercel logs before continuing.

---

## Task 5: Live smoke test — remote (emailed-link) flow

End-to-end test against AAA prod, mirroring the 15e smoke recipe with the addition of inbox + audit-row checks.

**Files:** none modified. Pre-existing data in AAA Supabase.

- [ ] **Step 1: Create the test contract**

Use the existing AAA template (e.g. WTR — `60862e63-59dc-4529-84e2-84724774ea3a`) attached to a real-looking job (e.g. Brenda Watson's `JOB-2026-0019`, the same one used in 15d/15e tests). Configure two signers:

- Signer 1: `name = "Test Signer 1"`, `email = "eric@aaacontracting.com"`, `signer_order = 1`
- Signer 2: `name = "Test Signer 2"`, `email = "eric@aaadisasterrecovery.com"`, `signer_order = 2`

Create via the AAA contract send modal (manual UI flow). The default email body must contain `{{signing_link}}` (15g guard-rail will block the send otherwise).

Capture the contract ID from the URL or the post-send toast.

- [ ] **Step 2: Sign as signer 1 via the email link**

Open the inbox for `eric@aaacontracting.com`, click the signing link from the request email, complete the signing form. After submit, verify:
- Page flips to "Awaiting other signer"
- No customer-confirmation email yet (those only fire after signer 2)

- [ ] **Step 3: Sign as signer 2 via the email link**

Open the inbox for `eric@aaadisasterrecovery.com`, click the handoff link from the email that just arrived, complete signing. After submit, verify the page flips to "This contract has been signed."

- [ ] **Step 4: Inbox check**

Three emails should now exist:

- Inbox `eric@aaacontracting.com`: customer-confirmation email with subject from `signed_confirmation_subject_template` (e.g. "Your signed copy of …"), and a PDF attachment named `<contract title sanitized>.pdf`.
- Inbox `eric@aaadisasterrecovery.com`: same template, same attachment.
- Inbox `eric@aaacontracting.com`: a SECOND email — the internal confirmation, with subject from the internal template. Same PDF attachment.

(Yes, `eric@aaacontracting.com` will receive two emails — one as signer 1 and one as the internal recipient via reply-to fallback. That's documented behaviour; do not deduplicate.)

- [ ] **Step 5: PDF verification**

Open at least one customer-email PDF attachment and confirm:
- Both signatures appear stamped at the expected coordinates
- Merge fields (customer_name, property_address, etc.) are resolved (not raw `{{tokens}}`)
- Date stamp matches the sign-time date

- [ ] **Step 6: Audit-row check**

Run via Supabase MCP `execute_sql`:

```sql
SELECT event_type, signer_id, metadata, created_at
FROM contract_events
WHERE contract_id = '<test contract id from step 1>'
  AND event_type = 'email_delivered'
ORDER BY created_at;
```

Expected rows (in order):

1. `kind: "next_signer_activation"` (or no error key) — written by 15e when signer 1 triggered the handoff. *Note: 15e only writes this on FAILURE; if signer 2's email succeeded, this row may not exist. That's fine; it only proves the absence of a handoff failure.*
2. `kind: "customer_confirmation"`, `signer_id: <signer 1 uuid>`, `provider: "resend"`, `message_id: <id>`, NO `error` key.
3. `kind: "customer_confirmation"`, `signer_id: <signer 2 uuid>`, `provider: "resend"`, `message_id: <id>`, NO `error` key.
4. `kind: "internal_confirmation"`, `provider: "resend"`, `message_id: <id>`, NO `error` key.

If any row has an `error` key, fix the underlying cause before continuing. If row 4 is missing, check that `resolveInternalRecipient` returned non-empty for AAA's row (reply_to_email should resolve to `eric@aaacontracting.com`).

- [ ] **Step 7: Capture the test contract ID for cleanup**

Save the contract ID, signer IDs, and stamped-PDF storage path in a scratch note. Used in Task 8.

---

## Task 6: Live smoke test — in-person (iPad) flow

Same destination behaviour, different starting route. Confirms the helper extraction symmetry holds.

**Files:** none modified.

- [ ] **Step 1: Create a second test contract**

Same template + job, but this time start the contract via "Sign in person" from the contract list / send modal so the contract is set up for iPad signing. Two signers, same emails as Task 5 (`eric@aaacontracting.com` and `eric@aaadisasterrecovery.com`).

- [ ] **Step 2: Sign signer 1 on the iPad route**

Open `/contracts/[id]/sign-in-person` (the in-person page) on a desktop browser logged in as eric. Complete signer 1's signing form + signature. Submit. Page should flip to signer 2's view (handoff in-place; no email is sent for in-person handoff per 15d design).

- [ ] **Step 3: Sign signer 2 on the iPad route**

Continue in the same in-person page; submit signer 2's signature. Page should flip to "All signed."

- [ ] **Step 4: Inbox check**

Same three-email expectation as Task 5 step 4. The fact that the contract was signed in-person should NOT change the email behaviour — both customer emails go out, plus the internal email.

- [ ] **Step 5: Audit-row check**

Same SELECT as Task 5 step 6, with the new contract ID. Expect three success rows: 2× `customer_confirmation` + 1× `internal_confirmation`. The `next_signer_activation` row will NOT exist (in-person flow does no token rotation), and that's correct.

- [ ] **Step 6: Capture this contract's IDs for cleanup**

Save for Task 8.

---

## Task 7: Live smoke test — failure path

Confirms best-effort isolation: a bad email on one signer does not block the other emails or the contract status flip.

**Files:** none modified. One temporary DB mutation.

- [ ] **Step 1: Create a third test contract**

Same template + job. Two signers; for signer 2, use a guaranteed-bouncing email — start with `eric@aaacontracting.com` for signer 1 (so you can verify it succeeds), then in step 2 corrupt signer 2's address.

- [ ] **Step 2: Corrupt signer 2's email at the DB**

After the contract is created but BEFORE you sign anyone, run via Supabase MCP `execute_sql`:

```sql
UPDATE contract_signers
SET email = 'bounce@simulator.amazonses.com'
WHERE contract_id = '<test contract id>'
  AND signer_order = 2;
```

(`bounce@simulator.amazonses.com` is AWS's deterministic-bounce mailbox — Resend may accept the send synchronously and rely on async bounce, OR may reject if it's flagged. Either way, the goal is to put a bad address on signer 2; if Resend accepts it, the test passes via the success-path audit rows and you can corrupt the address differently — e.g. `not-a-valid-email` will be rejected by Resend's input validation synchronously.)

If you need a guaranteed-sync-reject, instead run:

```sql
UPDATE contract_signers
SET email = 'invalid-email-address-no-at'
WHERE contract_id = '<test contract id>'
  AND signer_order = 2;
```

- [ ] **Step 3: Sign both signers (remote flow)**

Send the contract; sign as signer 1 via the emailed link. The handoff to signer 2 may also fail (it tries to email the bad address). That's fine — we want to see what happens AFTER all signers are signed.

To force signer 2's signing without their email arriving, retrieve the new `link_token` from the contracts row via Supabase MCP after `activate_next_signer` runs:

```sql
SELECT link_token FROM contracts WHERE id = '<test contract id>';
```

Then construct the URL `https://aaaplatform.vercel.app/sign/<link_token>` and complete the signing form there.

- [ ] **Step 4: Verify contract still flipped to signed**

```sql
SELECT status, signed_at, signed_pdf_path FROM contracts WHERE id = '<test contract id>';
```

Expected: `status = 'signed'`, `signed_at` populated, `signed_pdf_path` populated. Signing succeeded despite the bad email.

- [ ] **Step 5: Verify audit rows include the failure**

```sql
SELECT event_type, signer_id, metadata, created_at
FROM contract_events
WHERE contract_id = '<test contract id>'
  AND event_type = 'email_delivered'
ORDER BY created_at;
```

Expected:
- One row for `customer_confirmation` with `signer_id = <signer 1>` and NO `error` key (signer 1 succeeded).
- One row for `customer_confirmation` with `signer_id = <signer 2>` AND an `error: <message>` key (the bad address rejected).
- One row for `internal_confirmation` with NO `error` key (internal recipient succeeded — it goes to `eric@aaacontracting.com` regardless of signer 2's bad address).

If any of these are wrong, the helper's per-email try/catch isolation is broken. Investigate before proceeding.

- [ ] **Step 6: Restore signer 2's email (optional, for cleanup hygiene)**

Not strictly required since the contract is heading for deletion in Task 8, but good housekeeping:

```sql
UPDATE contract_signers
SET email = 'eric@aaadisasterrecovery.com'
WHERE contract_id = '<test contract id>'
  AND signer_order = 2;
```

---

## Task 8: Cleanup test artifacts

Deletes the three test contracts + their signature PNGs + stamped PDFs. Mirror the 15d Task 29 / 15e cleanup recipe.

**Files:** none modified. DB + storage mutations.

- [ ] **Step 1: Delete contract_events for the test contracts**

```sql
DELETE FROM contract_events
WHERE contract_id IN ('<contract 1 id>', '<contract 2 id>', '<contract 3 id>');
```

- [ ] **Step 2: Delete contract_signers**

```sql
DELETE FROM contract_signers
WHERE contract_id IN ('<contract 1 id>', '<contract 2 id>', '<contract 3 id>');
```

- [ ] **Step 3: Delete contracts**

```sql
DELETE FROM contracts
WHERE id IN ('<contract 1 id>', '<contract 2 id>', '<contract 3 id>');
```

- [ ] **Step 4: Delete storage objects**

The bucket `contract-pdfs` has the storage delete-protect trigger; use the same admin escape from 15d Task 29:

```sql
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects
WHERE bucket_id = 'contract-pdfs'
  AND (
    name LIKE 'a0000000-%/contracts/<contract 1 id>-signed.pdf'
    OR name LIKE 'a0000000-%/contracts/<contract 1 id>/signer-%.png'
    OR name LIKE 'a0000000-%/contracts/<contract 2 id>-signed.pdf'
    OR name LIKE 'a0000000-%/contracts/<contract 2 id>/signer-%.png'
    OR name LIKE 'a0000000-%/contracts/<contract 3 id>-signed.pdf'
    OR name LIKE 'a0000000-%/contracts/<contract 3 id>/signer-%.png'
  );
```

(Substitute the AAA org-id prefix into the patterns. The 15d/15e handoffs document the prefix as `a0000000-…`; verify with `SELECT id FROM organizations WHERE name ILIKE 'AAA%';` before running.)

- [ ] **Step 5: Confirm cleanup**

```sql
SELECT count(*) FROM contracts WHERE id IN ('<...>', '<...>', '<...>');
SELECT count(*) FROM contract_signers WHERE contract_id IN ('<...>', '<...>', '<...>');
SELECT count(*) FROM contract_events WHERE contract_id IN ('<...>', '<...>', '<...>');
```

All three should return 0.

---

## Task 9: Delete orphan files

Removes the three orphan source files. Separate commit so it's reversible if a regression surfaces post-merge.

**Files:**
- Delete: `src/app/api/contracts/[id]/sign/route.ts`
- Delete: `src/app/api/contracts/[id]/regenerate-pdf/route.ts`
- Delete: `src/lib/contracts/pdf.ts`

- [ ] **Step 1: Verify no callers**

Run from the repo root:

```bash
grep -rn 'contracts/\[id\]/sign\|contracts/\[id\]/regenerate\|from.*contracts/pdf"\|from "@/lib/contracts/pdf"' src/ --include='*.ts' --include='*.tsx'
```

Expected: NO output. Any results indicate a caller — investigate before deleting.

(The `/api/contracts/[id]/sign/` directory has been orphaned since 15d shipped; the new flow uses `/api/sign/[token]` and `/api/contracts/in-person` exclusively.)

- [ ] **Step 2: Delete the three files**

```bash
rm src/app/api/contracts/\[id\]/sign/route.ts
rm src/app/api/contracts/\[id\]/regenerate-pdf/route.ts
rm src/lib/contracts/pdf.ts
```

The empty `sign/` and `regenerate-pdf/` parent directories will be removed automatically by git on commit (git tracks files, not directories).

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors. If anything imported from the deleted files, the grep in Step 1 missed it — find and fix.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: `✓ Compiled successfully`. Page count drops by 2 (the two deleted route handlers no longer compile to routes).

- [ ] **Step 5: Commit**

```bash
git add -A src/app/api/contracts/\[id\]/sign src/app/api/contracts/\[id\]/regenerate-pdf src/lib/contracts/pdf.ts
git commit -m "$(cat <<'EOF'
chore(15h): delete orphan contract sign + regenerate-pdf routes

Removes:
- src/app/api/contracts/[id]/sign/route.ts (475 lines, no callers)
- src/app/api/contracts/[id]/regenerate-pdf/route.ts (100 lines, no callers)
- src/lib/contracts/pdf.ts (685 lines, only used by the two routes above)

The legacy HTML→PDF builder (pdf.ts) is replaced by the 15d pdf-lib
stamping pipeline in src/lib/contracts/stamp-pdf.ts. The legacy sign
route is replaced by /api/sign/[token] + /api/contracts/in-person.
The regenerate-pdf endpoint is intentionally not replaced — editing
a signed legal artifact is content modification under ESIGN/UETA;
the safe path for a bad PDF is void + re-sign.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Drop dead pdfjs postinstall

15e replaced `/pdf.worker.min.mjs?v=...` with bundler-resolved `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()` in `src/lib/pdf/configure-pdfjs.ts`. The `/public/pdf.worker.min.mjs` file populated by the postinstall is now dead weight.

**Files:**
- Modify: `package.json` — remove the postinstall script line
- Delete: `public/pdf.worker.min.mjs`

- [ ] **Step 1: Confirm the postinstall line**

Run: `grep -n postinstall /Users/vanessavance/Desktop/aaa-platform/package.json`
Expected: one line, e.g. `"postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs"`. If the project has more postinstall steps chained with `&&`, edit only the cp portion (do not remove a multi-step postinstall blindly).

- [ ] **Step 2: Edit package.json**

Open `package.json`. If the postinstall is the only postinstall step, delete the entire line (and adjust the trailing comma on the previous line if needed). If chained, remove only the `cp ...` segment.

Also confirm there's no comma syntax error after editing. Validate with:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"
```

Expected: no output (silent success). Any output is a JSON error.

- [ ] **Step 3: Delete the worker file from /public**

```bash
rm public/pdf.worker.min.mjs
```

- [ ] **Step 4: TypeScript + build check**

Run: `npx tsc --noEmit && npm run build`
Expected: both pass. The bundler will emit the worker into `_next/static/chunks/...mjs` from the import.meta.url resolver — the `/public/` copy was redundant.

- [ ] **Step 5: Smoke-check the signing page still loads its PDF**

Open `https://aaaplatform.vercel.app/login` in a browser (preview deploy, post-Task-9 push, but this can also be verified on local `npm run dev` if you're working locally first). Then open any signing page (use the link-token recovery technique from 15g if you don't have a live contract to hand). Confirm the PDF renders without console errors about `pdf.worker.min.mjs`.

If the worker fails to load, the bundler-resolution path in `src/lib/pdf/configure-pdfjs.ts` is broken — investigate before pushing.

- [ ] **Step 6: Commit**

```bash
git add package.json public/pdf.worker.min.mjs
git commit -m "$(cat <<'EOF'
chore(15h): drop dead pdfjs postinstall + /public worker

15e replaced the /public-served pdfjs worker with bundler-resolved
new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url) in
configure-pdfjs.ts. The postinstall cp-step and the /public/ copy are
both dead. Bundler emits the worker into _next/static/chunks at build
time, which is auth-proxy-exempt and content-hash-busted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification + push

Confirms the full post-15h state is clean before pushing the orphan-deletion + postinstall commits.

**Files:** none modified.

- [ ] **Step 1: Final tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Final build**

Run: `npm run build`
Expected: `✓ Compiled successfully`. Note the page count — should be 2 less than before Task 9 (the two deleted route handlers no longer compile to pages).

- [ ] **Step 3: Push to origin/main**

Run: `git push origin main`
Expected: fast-forward push succeeds. Vercel auto-deploys.

- [ ] **Step 4: Wait for deploy + spot-check**

Same as Task 4. After the deploy lands, hit the signing-page renderer one more time to confirm the worker still loads cleanly (no `/pdf.worker.min.mjs` 404 in the browser console — should pull from `_next/static/chunks/`).

- [ ] **Step 5: Done — write the handoff**

Run `/handoff` (or invoke the `end-of-session-handoff` skill) to update `docs/vault/00-NOW.md` and write the build-15h handoff doc.

---

## Risks recap (from spec, replicated here so the implementer doesn't have to context-switch)

- **Resend daily-send limit.** A 2-signer contract triggers up to 5 sends total (1 initial request, 1 handoff, 2 customer confirmations, 1 internal). Smoke testing 3 contracts in Tasks 5–7 = up to 15 sends. Well within limits.
- **Same email on customer + internal recipient.** If the org's reply-to address matches a signer email, that person gets two emails. Documented behaviour; no dedup.
- **Helper extraction symmetry.** Both routes are rewritten in the same commit; symmetric smoke (Tasks 5–6) covers both call paths.
- **Settings row missing.** Pre-flight (Task 1) catches this before code runs. Helper also has a runtime guard that writes one audit row and returns.
- **Pdfjs worker regression after postinstall removal.** Tasks 10 step 5 + Task 11 step 4 both check the signing PDF still renders. If it doesn't, the configure-pdfjs.ts bundler path is broken — the postinstall removal in Task 10 must be reverted.
