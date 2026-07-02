import type { Email } from "./types";

/** A bot sender's identity: the display-name + address PAIR (per ADR 0028). */
export interface BotSenderIdentity {
  name: string | null;
  address: string;
}

/** One collapsed group of unread mail from a single bot sender. */
export interface SenderGroup {
  key: string;
  name: string;
  address: string;
  unreadCount: number;
  latestSnippet: string | null;
  latestReceivedAt: string;
  emails: Email[];
}

/** The single aggregate row of drained (read) bot mail. */
export interface OlderUpdates {
  count: number;
  emails: Email[];
  latestReceivedAt: string | null;
}

export interface GroupedInbox {
  humanRows: Email[];
  senderGroups: SenderGroup[];
  olderUpdates: OlderUpdates | null;
}

/**
 * Canonical identity key for a bot sender: display-name + address, each
 * trimmed and lowercased and joined by a NUL that cannot occur in either.
 * A null/absent name normalizes to "" so a stored `display_name = ''` matches
 * an email with no `from_name`.
 */
export function botSenderKey(name: string | null | undefined, address: string): string {
  const n = (name ?? "").trim().toLowerCase();
  const a = (address ?? "").trim().toLowerCase();
  return `${n}\u0000${a}`;
}

/**
 * Split an already-filtered inbox list (single folder + category, no active
 * search) into human rows, per-sender bot groups, and one drained "Older
 * updates" row. Presentation-only — never mutates the message store.
 *
 * Callers pass emails newest-first (the list query's default order); the
 * engine preserves that order within human rows and each group.
 */
export function groupInbox(emails: Email[], botSenders: BotSenderIdentity[]): GroupedInbox {
  const botKeys = new Set(botSenders.map((b) => botSenderKey(b.name, b.address)));

  const humanRows: Email[] = [];
  // Preserve first-seen (newest-first) order of groups via an ordered map.
  const groups = new Map<string, SenderGroup>();
  const drained: Email[] = [];

  for (const email of emails) {
    const key = botSenderKey(email.from_name, email.from_address);
    const isBot = botKeys.has(key);

    if (!isBot) {
      humanRows.push(email);
      continue;
    }

    // Read bot mail drains to a single aggregate "Older updates" row,
    // regardless of which bot sender it came from.
    if (email.is_read) {
      drained.push(email);
      continue;
    }

    // Unread bot mail collapses into a per-sender group.
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: email.from_name ?? "",
        address: email.from_address,
        unreadCount: 0,
        latestSnippet: email.snippet,
        latestReceivedAt: email.received_at,
        emails: [],
      };
      groups.set(key, group);
    }
    group.emails.push(email);
    group.unreadCount += 1;
  }

  const olderUpdates: OlderUpdates | null =
    drained.length > 0
      ? {
          count: drained.length,
          emails: drained,
          latestReceivedAt: drained.reduce<string | null>(
            (latest, e) => (latest === null || e.received_at > latest ? e.received_at : latest),
            null,
          ),
        }
      : null;

  return {
    humanRows,
    senderGroups: [...groups.values()],
    olderUpdates,
  };
}
