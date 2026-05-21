import type { Email, EmailAccount } from "@/lib/types";

/**
 * Email-summary cache pipeline (PRD #56 slice 2, issue #173).
 *
 * `shapeEmailSummary` is the pure heart of the pipeline: it turns the inbox
 * data the web app already holds into the per-account snapshot the native
 * shell writes into the shared App Group container for the Emails widget to
 * render. It does no I/O and reads no clock — the write timestamp is passed
 * in — so it is fully unit-testable (issue #173 AC#4).
 */

/** The fields of an inbox `Email` the summary actually needs. */
export type EmailSummaryEmail = Pick<
  Email,
  | "id"
  | "account_id"
  | "from_address"
  | "from_name"
  | "subject"
  | "is_read"
  | "received_at"
>;

/** The fields of an `EmailAccount` the summary actually needs. */
export type EmailSummaryAccount = Pick<EmailAccount, "id" | "label" | "email_address">;

/** The inbox data handed to the shaper. */
export interface EmailSummaryInput {
  accounts: EmailSummaryAccount[];
  emails: EmailSummaryEmail[];
}

/** Most messages previewed per account — the Emails widget shows a few. */
export const PREVIEW_LIMIT = 3;

/** One message preview shown in the widget — sender + subject only. */
export interface EmailSummaryPreview {
  /** The email's id — the widget's deep link opens `nookleus://email?id=`. */
  id: string;
  sender: string;
  subject: string;
}

/** The per-account summary the widget renders for its configured mailbox. */
export interface AccountEmailSummary {
  accountId: string;
  label: string;
  unreadCount: number;
  /** Latest messages, newest first, capped at {@link PREVIEW_LIMIT}. */
  previews: EmailSummaryPreview[];
  /** When this account's summary was written (ISO 8601). */
  updatedAt: string;
}

/** The full snapshot written to the App Group container, keyed by account id. */
export interface EmailSummarySnapshot {
  /** When the snapshot was written (ISO 8601). */
  generatedAt: string;
  accounts: Record<string, AccountEmailSummary>;
}

export function shapeEmailSummary(
  input: EmailSummaryInput,
  generatedAt: string,
): EmailSummarySnapshot {
  const accounts: Record<string, AccountEmailSummary> = {};

  for (const acc of input.accounts) {
    // ISO 8601 timestamps sort lexicographically, so a string compare orders
    // them chronologically — newest first. `.filter` returns a fresh array,
    // so sorting it does not mutate the caller's `input.emails`.
    const accountEmails = input.emails
      .filter((e) => e.account_id === acc.id)
      .sort((a, b) => b.received_at.localeCompare(a.received_at));

    accounts[acc.id] = {
      accountId: acc.id,
      label: acc.label,
      unreadCount: accountEmails.filter((e) => !e.is_read).length,
      previews: accountEmails.slice(0, PREVIEW_LIMIT).map((e) => ({
        id: e.id,
        // A missing or blank display name falls back to the raw address.
        sender: e.from_name || e.from_address,
        subject: e.subject,
      })),
      updatedAt: generatedAt,
    };
  }

  return { generatedAt, accounts };
}
