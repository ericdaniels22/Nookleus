import { NextResponse, after } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { decrypt } from "@/lib/encryption";
import { ImapFlow } from "imapflow";
import { matchEmailToJob, type MatcherCache, type JobRow, type ContactRow } from "@/lib/email-matcher";
import { categorizeEmail, type CategoryRule, type Category } from "@/lib/email-categorizer";
import { emailAttachmentPath } from "@/lib/storage/paths";
import { syncFolderIncremental, type EmailFolderState } from "@/lib/email/sync-folder-incremental";

// Map IMAP folder names to our normalized folder enum.
// Kept for backfill Pass 2 (reverse-lookup of folder→imap path) and for
// resolving which IMAP path corresponds to "inbox" / "sent" at sync time.
function mapFolder(imapPath: string): string {
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

// POST /api/email/sync — sync emails for a specific account.
//
// Body: { accountId: string, maxPerFolder?: number }
//
// Steady-state behavior: opens IMAP, fetches UIDs above each folder's
// stored bookmark for Inbox + Sent only, batch-inserts the new emails,
// updates the bookmark. Attachment uploads continue in after() so they
// don't block the response.
//
// First sync per account also runs the one-time category backfill (Pass
// 1 + Pass 2) — that path is intentionally not optimized.
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const startedAt = Date.now();
  const { accountId, maxPerFolder = 50 } = await request.json();

  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const supabase = ctx.supabase;

  const { data: account, error: accError } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accError || !account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const orgId: string = account.organization_id;

  let password: string;
  try {
    password = decrypt(account.encrypted_password);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to decrypt password: ${err instanceof Error ? err.message : "check ENCRYPTION_KEY"}` },
      { status: 500 }
    );
  }

  let client: ImapFlow | null = null;
  let totalSynced = 0;
  let totalMatched = 0;
  let foldersSynced = 0;
  const errors: string[] = [];
  // Collected during sync; uploaded after the response via after().
  const attachmentJobs: Array<{
    emailId: string;
    parsedAttachments: import("mailparser").Attachment[];
  }> = [];

  try {
    client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_port === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
    });

    await client.connect();

    // Pre-fetch job matching cache (once for entire sync)
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

    // Folder discovery — needed by both backfill Pass 2 and the new
    // incremental sync below.
    const folders = await client.list();
    const folderPaths = folders.map((f) => f.path);

    // ---- One-time per-account category backfill (Pass 1 + Pass 2) ----
    // Kept intact, intentionally not optimized. Only runs on first sync.
    if (!account.category_backfill_completed_at) {
      // Pass 1: body/subject/domain-based
      let lastId: string | null = null;
      while (true) {
        let batchQuery = supabase
          .from("emails")
          .select("id, from_address, subject, body_text")
          .eq("account_id", accountId)
          .eq("category", "general")
          .order("id", { ascending: true })
          .limit(200);

        if (lastId) {
          batchQuery = batchQuery.gt("id", lastId);
        }

        const { data: oldEmails } = await batchQuery;
        if (!oldEmails || oldEmails.length === 0) break;

        const byCategory = new Map<Category, string[]>();
        for (const e of oldEmails as { id: string; from_address: string; subject: string; body_text: string | null }[]) {
          const cat = categorizeEmail(
            { from_address: e.from_address, subject: e.subject, body_text: e.body_text },
            categoryRules,
          );
          if (cat !== "general") {
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(e.id);
          }
        }

        for (const [cat, ids] of byCategory) {
          await supabase.from("emails").update({ category: cat }).in("id", ids);
        }

        lastId = (oldEmails[oldEmails.length - 1] as { id: string }).id;
        if (oldEmails.length < 200) break;
      }

      // Pass 2: IMAP header re-fetch for header-rule categories.
      const hasHeaderRules = categoryRules.some((r) => r.match_type === "header");
      if (hasHeaderRules) {
        const { data: remainingEmails } = await supabase
          .from("emails")
          .select("id, from_address, subject, body_text, folder, uid")
          .eq("account_id", accountId)
          .eq("category", "general")
          .not("uid", "is", null)
          .order("id", { ascending: true })
          .limit(500);

        if (remainingEmails && remainingEmails.length > 0) {
          const byFolder = new Map<string, { id: string; uid: number; fromAddr: string; subject: string; bodyText: string | null }[]>();
          for (const e of remainingEmails as { id: string; from_address: string; subject: string; body_text: string | null; folder: string; uid: number }[]) {
            if (!byFolder.has(e.folder)) byFolder.set(e.folder, []);
            byFolder.get(e.folder)!.push({
              id: e.id,
              uid: e.uid,
              fromAddr: e.from_address,
              subject: e.subject,
              bodyText: e.body_text,
            });
          }

          const imapFolderPath = new Map<string, string>();
          for (const path of folderPaths) {
            const mapped = mapFolder(path);
            if (!imapFolderPath.has(mapped)) imapFolderPath.set(mapped, path);
          }

          for (const [folderName, emailsInFolder] of byFolder) {
            const imapPath = imapFolderPath.get(folderName);
            if (!imapPath) continue;

            try {
              await client.mailboxOpen(imapPath);
              const uidsToFetch = emailsInFolder.map((e) => e.uid).join(",");
              const emailByUid = new Map(emailsInFolder.map((e) => [e.uid, e]));
              const updatesByCategory = new Map<Category, string[]>();

              try {
                for await (const msg of client.fetch(
                  uidsToFetch,
                  { uid: true, headers: true },
                  { uid: true },
                )) {
                  const matchedEmail = emailByUid.get(msg.uid);
                  if (!matchedEmail) continue;

                  const msgHeaders: Record<string, string> = {};
                  if (msg.headers) {
                    const raw = msg.headers.toString("utf-8");
                    for (const line of raw.split(/\r?\n/)) {
                      const idx = line.indexOf(":");
                      if (idx > 0) {
                        const key = line.slice(0, idx).trim().toLowerCase();
                        const value = line.slice(idx + 1).trim();
                        if (key && !(key in msgHeaders)) {
                          msgHeaders[key] = value;
                        }
                      }
                    }
                  }

                  const cat = categorizeEmail(
                    {
                      from_address: matchedEmail.fromAddr,
                      subject: matchedEmail.subject,
                      headers: msgHeaders,
                      body_text: matchedEmail.bodyText,
                    },
                    categoryRules,
                  );

                  if (cat !== "general") {
                    if (!updatesByCategory.has(cat)) updatesByCategory.set(cat, []);
                    updatesByCategory.get(cat)!.push(matchedEmail.id);
                  }
                }
              } catch {
                // Folder fetch error — skip this folder
              }

              for (const [cat, ids] of updatesByCategory) {
                await supabase.from("emails").update({ category: cat }).in("id", ids);
              }

              await client.mailboxClose();
            } catch {
              // Folder open error — skip
            }
          }
        }
      }

      await supabase
        .from("email_accounts")
        .update({ category_backfill_completed_at: new Date().toISOString() })
        .eq("id", accountId);
    }

    // ---- Incremental sync: Inbox + Sent only ----
    const imapPathByFolder = new Map<string, string>();
    for (const path of folderPaths) {
      const normalized = mapFolder(path);
      if ((normalized === "inbox" || normalized === "sent") && !imapPathByFolder.has(normalized)) {
        imapPathByFolder.set(normalized, path);
      }
    }
    // Inbox is the one folder every IMAP server must have; fall back to
    // the literal name if discovery missed it (e.g. permissions quirks).
    if (!imapPathByFolder.has("inbox")) imapPathByFolder.set("inbox", "INBOX");

    // Load existing bookmark state for this account up-front so each
    // folder sync just consults the in-memory map.
    const { data: stateRows } = await supabase
      .from("email_folder_state")
      .select("*")
      .eq("account_id", accountId);
    const stateByFolder = new Map<string, EmailFolderState>(
      (stateRows || []).map((r: EmailFolderState) => [r.folder, r]),
    );

    // SEQUENTIAL, not Promise.all: imapflow's `mailboxOpen` is NOT safe
    // to call concurrently on a single connection. The active mailbox is
    // shared state, so two parallel `mailboxOpen` calls race — one
    // overwrites the other and the in-flight `fetch` ends up reading the
    // wrong mailbox. (Idiomatic concurrent access uses `getMailboxLock`;
    // bare `mailboxOpen` + `fetch` requires serial scheduling.) Spec's
    // own timing budget (open/check/close per folder, ~900ms total)
    // already assumed serial — the "in parallel" phrasing was wrong for
    // a single connection. Multi-account parallel still works because
    // each account opens its own client (see email-inbox.tsx).
    const perFolderResults: { folder: string; synced: number; matched: number }[] = [];
    for (const [folder, imapPath] of imapPathByFolder.entries()) {
      const r = await (async () => {
        const result = await syncFolderIncremental({
          client: client!,
          account: { id: accountId, organization_id: orgId },
          folder,
          imapPath,
          state: stateByFolder.get(folder) ?? null,
          bootstrapLimit: maxPerFolder,
        });

        // Targeted dedup, bootstrap-only. Steady-state UIDs above the
        // bookmark are by definition new.
        let candidates = result.newEmails;
        if (result.bootstrapped && candidates.length > 0) {
          const ids = candidates.map((c) => c.messageId);
          const { data: known } = await supabase
            .from("emails")
            .select("message_id")
            .eq("account_id", accountId)
            .eq("folder", folder)
            .in("message_id", ids);
          const knownSet = new Set(
            (known || []).map((e: { message_id: string }) => e.message_id),
          );
          candidates = candidates.filter((c) => !knownSet.has(c.messageId));
        }

        let synced = 0;
        let matched = 0;

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
              account_id: accountId,
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
            errors.push(`${folder} batch insert: ${insertError.message}`);
          } else if (insertedEmails) {
            synced = insertedEmails.length;
            matched = rows.filter((r) => r.job_id).length;
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
                emailId,
                parsedAttachments: p.parsedAttachments,
              });
            }
          }
        }

        // Persist the new bookmark. Skip when mailbox open failed —
        // syncFolderIncremental returns newState=null in that case so
        // the existing row stays intact.
        if (result.newState) {
          const { error: stateErr } = await supabase
            .from("email_folder_state")
            .upsert(result.newState, { onConflict: "account_id,folder" });
          if (stateErr) {
            errors.push(`${folder} state upsert: ${stateErr.message}`);
          }
        }

        for (const e of result.errors) {
          errors.push(`${folder}: ${e}`);
        }

        return { folder, synced, matched };
      })();
      perFolderResults.push(r);
    }

    for (const r of perFolderResults) {
      totalSynced += r.synced;
      totalMatched += r.matched;
    }
    foldersSynced = perFolderResults.length;

    await supabase
      .from("email_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", accountId);

    await client.logout();
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Sync failed",
        total_synced: totalSynced,
        total_matched: totalMatched,
      },
      { status: 500 },
    );
  }

  // Deferred attachment uploads — Fluid Compute keeps the function alive
  // long enough for these to finish without holding up the response.
  if (attachmentJobs.length > 0) {
    after(async () => {
      for (const job of attachmentJobs) {
        await Promise.all(
          job.parsedAttachments.map(async (att) => {
            try {
              const storagePath = emailAttachmentPath(
                orgId,
                accountId,
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
    `[email-sync] account=${accountId} synced=${totalSynced} matched=${totalMatched} duration=${duration}ms`,
  );

  return NextResponse.json({
    total_synced: totalSynced,
    total_matched: totalMatched,
    folders_synced: foldersSynced,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
});
