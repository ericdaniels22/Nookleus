import { NextRequest, NextResponse, after } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { decrypt } from "@/lib/encryption";
import { ImapFlow } from "imapflow";
import { matchEmailToJob, type MatcherCache, type JobRow, type ContactRow } from "@/lib/email-matcher";
import { categorizeEmail, type CategoryRule } from "@/lib/email-categorizer";
import { emailAttachmentPath } from "@/lib/storage/paths";
import { syncFolderIncremental, type EmailFolderState } from "@/lib/email/sync-folder-incremental";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// Subset of mapFolder from /api/email/sync — we only need the target
// folder names this endpoint supports.
function normalizeFolder(imapPath: string): string {
  const lower = imapPath.toLowerCase().replace(/^(\[gmail\]|inbox)\/?/i, "").trim();
  const original = imapPath.toLowerCase();
  if (original === "inbox") return "inbox";
  if (lower === "sent" || lower === "sent messages" || lower === "sent items" || lower === "sent mail")
    return "sent";
  if (lower === "drafts" || lower === "draft") return "drafts";
  if (lower === "trash" || lower === "deleted items" || lower === "deleted messages" || lower === "bin")
    return "trash";
  if (lower === "spam" || lower === "junk" || lower === "junk e-mail" || lower === "bulk mail")
    return "spam";
  if (lower === "archive" || lower === "all mail" || lower === "archives")
    return "archive";
  if (original.includes("sent")) return "sent";
  if (original.includes("draft")) return "drafts";
  if (original.includes("trash") || original.includes("deleted")) return "trash";
  if (original.includes("spam") || original.includes("junk")) return "spam";
  if (original.includes("archive") || original.includes("all mail")) return "archive";
  return original;
}

const ALLOWED_FOLDERS = new Set([
  "inbox",
  "sent",
  "drafts",
  "trash",
  "spam",
  "archive",
]);

// POST /api/email/sync-folder — lazy per-tab refresh.
//
// Body: { accountId?: string, folder: "inbox"|"sent"|"drafts"|"trash"|"spam"|"archive" }
//
// When accountId is omitted, fans out across all active accounts in the
// active org in parallel. Each account opens its own IMAP connection,
// resolves the requested folder via folder discovery, and runs the
// incremental sync algorithm — same as /api/email/sync but for a single
// folder and without the one-time category backfill.
//
// The client throttles concurrent calls; this endpoint always does the
// work it's asked to do.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const body = (await request.json()) as { accountId?: string; folder?: string };
  const { accountId, folder } = body;

  if (!folder || !ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json(
      { error: "folder is required (inbox, sent, drafts, trash, spam, archive)" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 401 });
  }

  // Resolve target accounts. Without accountId, fan out across all
  // active accounts in this org.
  let accountsQuery = supabase
    .from("email_accounts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (accountId) {
    accountsQuery = accountsQuery.eq("id", accountId);
  }
  const { data: accounts, error: accErr } = await accountsQuery;
  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500 });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ total_synced: 0 });
  }

  // Matcher cache + category rules — org-scoped, shared across all fan-out accounts.
  const { data: jobsData } = await supabase
    .from("jobs")
    .select("id, job_number, claim_number, property_address, contact_id, job_adjusters(contact_id)")
    .eq("organization_id", orgId)
    .not("status", "eq", "cancelled");
  const jobs = (jobsData || []) as JobRow[];

  const contactIds = new Set<string>();
  for (const job of jobs) {
    contactIds.add(job.contact_id);
    if (job.job_adjusters) {
      for (const ja of job.job_adjusters) {
        contactIds.add(ja.contact_id);
      }
    }
  }
  let contacts: ContactRow[] = [];
  if (contactIds.size > 0) {
    const { data: contactsData } = await supabase
      .from("contacts")
      .select("id, email")
      .eq("organization_id", orgId)
      .in("id", Array.from(contactIds))
      .not("email", "is", null);
    contacts = (contactsData || []) as ContactRow[];
  }
  const matcherCache: MatcherCache = { jobs, contacts };

  const { data: rulesData } = await supabase
    .from("category_rules")
    .select("match_type, match_value, category")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .eq("is_active", true);
  const categoryRules = (rulesData || []) as CategoryRule[];

  const attachmentJobs: Array<{
    accountId: string;
    emailId: string;
    parsedAttachments: import("mailparser").Attachment[];
  }> = [];
  const errors: string[] = [];
  let totalSynced = 0;

  await Promise.all(
    accounts.map(async (account: typeof accounts[number]) => {
      let client: ImapFlow | null = null;
      try {
        let password: string;
        try {
          password = decrypt(account.encrypted_password);
        } catch (decErr) {
          errors.push(
            `account ${account.id}: decrypt failed (${decErr instanceof Error ? decErr.message : "unknown"})`,
          );
          return;
        }

        client = new ImapFlow({
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_port === 993,
          auth: { user: account.username, pass: password },
          logger: false,
          tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
        });

        await client.connect();

        const remoteFolders = await client.list();
        let imapPath: string | null = null;
        for (const f of remoteFolders) {
          if (normalizeFolder(f.path) === folder) {
            imapPath = f.path;
            break;
          }
        }
        if (!imapPath && folder === "inbox") imapPath = "INBOX";
        if (!imapPath) {
          // Server doesn't have this folder — not an error, just skip.
          await client.logout();
          return;
        }

        const { data: stateRow } = await supabase
          .from("email_folder_state")
          .select("*")
          .eq("account_id", account.id)
          .eq("folder", folder)
          .maybeSingle();

        const result = await syncFolderIncremental({
          client,
          account: { id: account.id, organization_id: orgId },
          folder,
          imapPath,
          state: (stateRow as EmailFolderState | null) ?? null,
        });

        let candidates = result.newEmails;
        if (result.bootstrapped && candidates.length > 0) {
          const ids = candidates.map((c) => c.messageId);
          const { data: known } = await supabase
            .from("emails")
            .select("message_id")
            .eq("account_id", account.id)
            .eq("folder", folder)
            .in("message_id", ids);
          const knownSet = new Set(
            (known || []).map((e: { message_id: string }) => e.message_id),
          );
          candidates = candidates.filter((c) => !knownSet.has(c.messageId));
        }

        if (candidates.length > 0) {
          const rows = candidates.map((p) => {
            const match = matchEmailToJob(
              matcherCache,
              {
                from_address: p.fromAddr,
                to_addresses: p.toAddresses,
                subject: p.subject,
                body_text: p.bodyText,
              },
              account.email_address,
            );
            const category = categorizeEmail(
              {
                from_address: p.fromAddr,
                subject: p.subject,
                headers: p.headers,
                body_text: p.bodyText,
              },
              categoryRules,
            );
            return {
              organization_id: orgId,
              account_id: account.id,
              job_id: match?.job_id || null,
              message_id: p.messageId,
              thread_id: p.threadId,
              folder,
              from_address: p.fromAddr,
              from_name: p.fromName,
              to_addresses: p.toAddresses,
              cc_addresses: p.ccAddresses,
              bcc_addresses: [],
              subject: p.subject,
              body_text: p.bodyText,
              body_html: p.bodyHtml,
              snippet: p.snippet,
              is_read: folder === "sent" || folder === "drafts",
              is_starred: false,
              has_attachments: p.hasAttachments,
              matched_by: match?.matched_by || null,
              uid: p.uid,
              received_at: p.receivedAt,
              category,
            };
          });

          const { data: insertedEmails, error: insertError } = await supabase
            .from("emails")
            .insert(rows)
            .select("id, message_id");
          if (insertError) {
            errors.push(`${account.id} ${folder}: ${insertError.message}`);
          } else if (insertedEmails) {
            totalSynced += insertedEmails.length;
            const emailIdByMessageId = new Map(
              insertedEmails.map((e: { id: string; message_id: string }) => [
                e.message_id,
                e.id,
              ]),
            );
            for (const p of candidates) {
              if (p.parsedAttachments.length === 0) continue;
              const emailId = emailIdByMessageId.get(p.messageId);
              if (!emailId) continue;
              attachmentJobs.push({
                accountId: account.id,
                emailId,
                parsedAttachments: p.parsedAttachments,
              });
            }
          }
        }

        if (result.newState) {
          const { error: stateErr } = await supabase
            .from("email_folder_state")
            .upsert(result.newState, { onConflict: "account_id,folder" });
          if (stateErr) {
            errors.push(`${account.id} state upsert: ${stateErr.message}`);
          }
        }

        for (const e of result.errors) {
          errors.push(`${account.id} ${folder}: ${e}`);
        }

        await supabase
          .from("email_accounts")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", account.id);

        await client.logout();
      } catch (accountErr) {
        errors.push(
          `account ${account.id}: ${accountErr instanceof Error ? accountErr.message : "sync error"}`,
        );
        if (client) {
          try {
            await client.logout();
          } catch {
            // logout-after-error is best-effort
          }
        }
      }
    }),
  );

  if (attachmentJobs.length > 0) {
    after(async () => {
      for (const job of attachmentJobs) {
        await Promise.all(
          job.parsedAttachments.map(async (att) => {
            try {
              const storagePath = emailAttachmentPath(
                orgId,
                job.accountId,
                job.emailId,
                att.filename || "attachment",
              );
              await supabase.storage
                .from("email-attachments")
                .upload(storagePath, att.content, {
                  contentType: att.contentType || "application/octet-stream",
                  upsert: true,
                });
              await supabase.from("email_attachments").insert({
                organization_id: orgId,
                email_id: job.emailId,
                filename: att.filename || "attachment",
                content_type: att.contentType || null,
                file_size: att.size || null,
                storage_path: storagePath,
              });
            } catch (uploadErr) {
              console.warn(
                `[email-sync] attachment-upload-fail email=${job.emailId} ${uploadErr instanceof Error ? uploadErr.message : "unknown"}`,
              );
            }
          }),
        );
      }
    });
  }

  const duration = Date.now() - startedAt;
  console.log(
    `[email-sync] folder=${folder} accounts=${accounts.length} synced=${totalSynced} duration=${duration}ms`,
  );

  return NextResponse.json({
    total_synced: totalSynced,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
