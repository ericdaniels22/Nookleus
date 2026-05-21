import { describe, expect, it } from "vitest";

import {
  shapeEmailSummary,
  type EmailSummaryAccount,
  type EmailSummaryEmail,
} from "./email-summary";

function account(
  partial: Partial<EmailSummaryAccount> & { id: string },
): EmailSummaryAccount {
  return {
    label: partial.id,
    email_address: `${partial.id}@example.com`,
    ...partial,
  };
}

function email(
  partial: Partial<EmailSummaryEmail> & { account_id: string },
): EmailSummaryEmail {
  return {
    from_address: "sender@example.com",
    from_name: "Sender",
    subject: "A subject",
    is_read: true,
    received_at: "2026-05-21T10:00:00Z",
    ...partial,
  };
}

describe("shapeEmailSummary", () => {
  it("produces an empty snapshot when there are no accounts", () => {
    const snapshot = shapeEmailSummary(
      { accounts: [], emails: [] },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot).toEqual({
      generatedAt: "2026-05-21T12:00:00Z",
      accounts: {},
    });
  });

  it("includes an account with no emails as a zero-count, empty-preview entry", () => {
    const snapshot = shapeEmailSummary(
      { accounts: [account({ id: "acc-1", label: "Team" })], emails: [] },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"]).toEqual({
      accountId: "acc-1",
      label: "Team",
      unreadCount: 0,
      previews: [],
      updatedAt: "2026-05-21T12:00:00Z",
    });
  });

  it("counts an account's unread emails", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({ account_id: "acc-1", is_read: false }),
          email({ account_id: "acc-1", is_read: false }),
          email({ account_id: "acc-1", is_read: true }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].unreadCount).toBe(2);
  });

  it("builds a preview with the sender name and subject for each email", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({
            account_id: "acc-1",
            from_name: "Pat Adjuster",
            subject: "Roof leak claim",
          }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].previews).toEqual([
      { sender: "Pat Adjuster", subject: "Roof leak claim" },
    ]);
  });

  it("caps previews at three messages per account", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({ account_id: "acc-1", received_at: "2026-05-21T05:00:00Z" }),
          email({ account_id: "acc-1", received_at: "2026-05-21T06:00:00Z" }),
          email({ account_id: "acc-1", received_at: "2026-05-21T07:00:00Z" }),
          email({ account_id: "acc-1", received_at: "2026-05-21T08:00:00Z" }),
          email({ account_id: "acc-1", received_at: "2026-05-21T09:00:00Z" }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].previews).toHaveLength(3);
  });

  it("orders previews newest first regardless of input order", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({ account_id: "acc-1", subject: "Oldest", received_at: "2026-05-21T08:00:00Z" }),
          email({ account_id: "acc-1", subject: "Newest", received_at: "2026-05-21T11:00:00Z" }),
          email({ account_id: "acc-1", subject: "Middle", received_at: "2026-05-21T09:30:00Z" }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].previews.map((p) => p.subject)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  it("falls back to the email address when a sender has no display name", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({
            account_id: "acc-1",
            from_name: null,
            from_address: "claims@insurer.com",
          }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].previews[0].sender).toBe(
      "claims@insurer.com",
    );
  });

  it("routes each email to its own account", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" }), account({ id: "acc-2" })],
        emails: [
          email({ account_id: "acc-1", subject: "For one", is_read: false }),
          email({ account_id: "acc-2", subject: "For two", is_read: true }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(snapshot.accounts["acc-1"].previews.map((p) => p.subject)).toEqual([
      "For one",
    ]);
    expect(snapshot.accounts["acc-1"].unreadCount).toBe(1);
    expect(snapshot.accounts["acc-2"].previews.map((p) => p.subject)).toEqual([
      "For two",
    ]);
    expect(snapshot.accounts["acc-2"].unreadCount).toBe(0);
  });

  it("ignores emails whose account is not in the account list", () => {
    const snapshot = shapeEmailSummary(
      {
        accounts: [account({ id: "acc-1" })],
        emails: [
          email({ account_id: "acc-1", is_read: false }),
          email({ account_id: "deleted-acc", is_read: false }),
        ],
      },
      "2026-05-21T12:00:00Z",
    );

    expect(Object.keys(snapshot.accounts)).toEqual(["acc-1"]);
    expect(snapshot.accounts["acc-1"].unreadCount).toBe(1);
  });
});
