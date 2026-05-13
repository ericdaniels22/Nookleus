import { simpleParser, type Attachment } from "mailparser";

export interface ParsedEmail {
  uid: number;
  messageId: string;
  threadId: string;
  fromAddr: string;
  fromName: string | null;
  toAddresses: { email: string; name?: string }[];
  ccAddresses: { email: string; name?: string }[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  receivedAt: Date;
  parsedAttachments: Attachment[];
  headers: Record<string, string>;
}

export interface EmailFolderState {
  organization_id: string;
  account_id: string;
  folder: string;
  imap_path: string;
  uid_validity: number;
  last_uid_seen: number;
  last_synced_at: string;
}

interface ImapEnvelope {
  messageId?: string | null;
  subject?: string | null;
  from?: { address?: string | null; name?: string | null }[];
  to?: { address?: string | null; name?: string | null }[];
  cc?: { address?: string | null; name?: string | null }[];
  date?: Date | null;
  inReplyTo?: string | null;
}

interface ImapFetchedMessage {
  uid: number;
  envelope?: ImapEnvelope;
  source?: Buffer;
  bodyStructure?: unknown;
}

export interface ImapClientLike {
  mailboxOpen(
    path: string,
    opts?: { readOnly?: boolean },
  ): Promise<{ uidValidity: number | bigint; exists?: number }>;
  mailboxClose(): Promise<unknown>;
  fetch(
    range: string,
    query: unknown,
    opts?: unknown,
  ): AsyncIterable<ImapFetchedMessage>;
}

export interface IncrementalSyncInput {
  client: ImapClientLike;
  account: { id: string; organization_id: string };
  folder: string;
  imapPath: string;
  state: EmailFolderState | null;
  bootstrapLimit?: number;
}

export interface IncrementalSyncResult {
  newEmails: ParsedEmail[];
  newState: EmailFolderState | null;
  errors: string[];
  bootstrapped: boolean;
}

const DEFAULT_BOOTSTRAP_LIMIT = 50;

export async function syncFolderIncremental(
  input: IncrementalSyncInput,
): Promise<IncrementalSyncResult> {
  const { client, account, folder, imapPath, state } = input;
  const limit = input.bootstrapLimit ?? DEFAULT_BOOTSTRAP_LIMIT;

  let mailbox: { uidValidity: number | bigint; exists?: number };
  try {
    mailbox = await client.mailboxOpen(imapPath, { readOnly: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      newEmails: [],
      newState: null,
      errors: [`mailbox-open ${imapPath}: ${message}`],
      bootstrapped: false,
    };
  }
  const uidValidity = Number(mailbox.uidValidity);
  const exists = mailbox.exists ?? 0;

  const uidvalidityMismatch =
    state !== null && state.uid_validity !== uidValidity;
  if (uidvalidityMismatch) {
    console.warn(
      `[email-sync] uidvalidity-reset account=${account.id} folder=${folder} old=${state.uid_validity} new=${uidValidity}`,
    );
  }
  const bootstrap = state === null || uidvalidityMismatch;
  const newEmails: ParsedEmail[] = [];
  let maxUid = bootstrap ? 0 : state.last_uid_seen;

  const FETCH_QUERY = {
    uid: true,
    envelope: true,
    source: true,
    bodyStructure: true,
  };

  const iter = bootstrap
    ? client.fetch(`${Math.max(1, exists - limit + 1)}:*`, FETCH_QUERY)
    : client.fetch(`${state.last_uid_seen + 1}:*`, FETCH_QUERY, { uid: true });

  for await (const msg of iter) {
    const parsed = await parseMessage(msg);
    if (!parsed) continue;
    newEmails.push(parsed);
    if (parsed.uid > maxUid) maxUid = parsed.uid;
  }

  await client.mailboxClose();

  const newState: EmailFolderState = {
    organization_id: account.organization_id,
    account_id: account.id,
    folder,
    imap_path: imapPath,
    uid_validity: uidValidity,
    last_uid_seen: maxUid,
    last_synced_at: new Date().toISOString(),
  };

  return {
    newEmails,
    newState,
    errors: [],
    bootstrapped: bootstrap,
  };
}

interface BodyStructureNode {
  disposition?: string | null;
  childNodes?: BodyStructureNode[];
}

function bodyStructureHasAttachments(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as BodyStructureNode;
  if (n.disposition === "attachment") return true;
  if (n.childNodes) return n.childNodes.some(bodyStructureHasAttachments);
  return false;
}

async function parseMessage(
  msg: ImapFetchedMessage,
): Promise<ParsedEmail | null> {
  const envelope = msg.envelope;
  if (!envelope) return null;

  const uid = msg.uid;
  const messageId =
    envelope.messageId || `uid-${uid}`;

  let bodyText = "";
  let bodyHtml = "";
  let hasAttachments = false;
  let parsedAttachments: Attachment[] = [];
  const headers: Record<string, string> = {};

  if (msg.source) {
    const parsed = await simpleParser(msg.source);
    bodyText = parsed.text || "";
    bodyHtml = typeof parsed.html === "string" ? parsed.html : "";
    parsedAttachments = parsed.attachments || [];
    hasAttachments = parsedAttachments.length > 0;
    if (parsed.headers) {
      for (const [key, value] of parsed.headers) {
        headers[key.toLowerCase()] = String(value);
      }
    }
  }

  // Fallback: simpleParser sometimes misses attachments that the IMAP
  // bodyStructure already advertises. We don't have the bytes to upload,
  // but we still want has_attachments=true so the reader UI can show the
  // "Downloading…" placeholder while the after() upload finishes.
  if (!hasAttachments && msg.bodyStructure) {
    hasAttachments = bodyStructureHasAttachments(msg.bodyStructure);
  }

  const fromAddr = envelope.from?.[0]?.address || "";
  const fromName = envelope.from?.[0]?.name || "";
  const subject = envelope.subject || "";
  const date = envelope.date || new Date();

  const toAddresses = (envelope.to || []).map((a) => ({
    email: a.address || "",
    name: a.name || undefined,
  }));
  const ccAddresses = (envelope.cc || []).map((a) => ({
    email: a.address || "",
    name: a.name || undefined,
  }));

  const threadId = envelope.inReplyTo || messageId;
  const snippet =
    bodyText
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || null;

  return {
    uid,
    messageId,
    threadId,
    fromAddr,
    fromName: fromName || null,
    toAddresses,
    ccAddresses,
    subject,
    bodyText: bodyText || null,
    bodyHtml: bodyHtml || null,
    snippet,
    hasAttachments,
    receivedAt: date,
    parsedAttachments,
    headers,
  };
}
