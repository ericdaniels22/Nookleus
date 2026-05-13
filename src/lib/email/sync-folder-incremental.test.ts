import { describe, it, expect, vi } from "vitest";
import { syncFolderIncremental } from "./sync-folder-incremental";
import type { ImapClientLike } from "./sync-folder-incremental";

type Msg = {
  uid: number;
  envelope: {
    messageId?: string | null;
    subject?: string | null;
    from?: { address?: string | null; name?: string | null }[];
    to?: { address?: string | null; name?: string | null }[];
    cc?: { address?: string | null; name?: string | null }[];
    date?: Date | null;
    inReplyTo?: string | null;
  };
  source?: Buffer;
  bodyStructure?: unknown;
};

function makeClient(opts: {
  uidValidity: number;
  exists: number;
  messages: Msg[];
}): ImapClientLike & {
  mailboxOpen: ReturnType<typeof vi.fn>;
  mailboxClose: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
} {
  return {
    mailboxOpen: vi.fn(async () => ({
      uidValidity: opts.uidValidity,
      exists: opts.exists,
    })),
    mailboxClose: vi.fn(async () => undefined),
    fetch: vi.fn(async function* () {
      for (const m of opts.messages) yield m;
    }),
  };
}

describe("syncFolderIncremental", () => {
  it("bootstraps when no prior state exists", async () => {
    const client = makeClient({
      uidValidity: 100,
      exists: 1,
      messages: [
        {
          uid: 42,
          envelope: {
            messageId: "<a@x>",
            subject: "Hello",
            from: [{ address: "alice@example.com", name: "Alice" }],
            to: [{ address: "bob@example.com" }],
            cc: [],
            date: new Date("2026-05-01T10:00:00Z"),
            inReplyTo: null,
          },
        },
      ],
    });

    const result = await syncFolderIncremental({
      client,
      account: { id: "acc-1", organization_id: "org-1" },
      folder: "inbox",
      imapPath: "INBOX",
      state: null,
    });

    expect(result.bootstrapped).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.newEmails).toHaveLength(1);
    expect(result.newEmails[0]?.uid).toBe(42);
    expect(result.newEmails[0]?.messageId).toBe("<a@x>");
    expect(result.newEmails[0]?.fromAddr).toBe("alice@example.com");
    expect(result.newState).toEqual(
      expect.objectContaining({
        organization_id: "org-1",
        account_id: "acc-1",
        folder: "inbox",
        imap_path: "INBOX",
        uid_validity: 100,
        last_uid_seen: 42,
      }),
    );
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(client.mailboxClose).toHaveBeenCalled();
  });

  it("returns no candidates when steady-state fetch is empty", async () => {
    const client = makeClient({
      uidValidity: 100,
      exists: 5,
      messages: [],
    });

    const priorState = {
      organization_id: "org-1",
      account_id: "acc-1",
      folder: "inbox",
      imap_path: "INBOX",
      uid_validity: 100,
      last_uid_seen: 42,
      last_synced_at: "2026-05-13T10:00:00.000Z",
    };

    const result = await syncFolderIncremental({
      client,
      account: { id: "acc-1", organization_id: "org-1" },
      folder: "inbox",
      imapPath: "INBOX",
      state: priorState,
    });

    expect(result.bootstrapped).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.newEmails).toEqual([]);
    expect(result.newState).toEqual(
      expect.objectContaining({
        uid_validity: 100,
        last_uid_seen: 42,
      }),
    );
    expect(result.newState?.last_synced_at).not.toBe(priorState.last_synced_at);

    // Asks the server for UIDs greater than the bookmark, in uid mode.
    expect(client.fetch).toHaveBeenCalledWith(
      "43:*",
      expect.any(Object),
      { uid: true },
    );
  });

  it("returns only UIDs above the bookmark and advances the bookmark", async () => {
    const client = makeClient({
      uidValidity: 100,
      exists: 50,
      messages: [
        {
          uid: 43,
          envelope: {
            messageId: "<m43@x>",
            subject: "first new",
            from: [{ address: "a@x.com" }],
            date: new Date("2026-05-13T09:00:00Z"),
          },
        },
        {
          uid: 47,
          envelope: {
            messageId: "<m47@x>",
            subject: "later new",
            from: [{ address: "b@x.com" }],
            date: new Date("2026-05-13T09:10:00Z"),
          },
        },
      ],
    });

    const priorState = {
      organization_id: "org-1",
      account_id: "acc-1",
      folder: "inbox",
      imap_path: "INBOX",
      uid_validity: 100,
      last_uid_seen: 42,
      last_synced_at: "2026-05-13T08:00:00.000Z",
    };

    const result = await syncFolderIncremental({
      client,
      account: { id: "acc-1", organization_id: "org-1" },
      folder: "inbox",
      imapPath: "INBOX",
      state: priorState,
    });

    expect(result.bootstrapped).toBe(false);
    expect(result.newEmails.map((e) => e.uid)).toEqual([43, 47]);
    expect(result.newState?.last_uid_seen).toBe(47);
    expect(result.newState?.uid_validity).toBe(100);
  });

  it("re-bootstraps when UIDVALIDITY changes and logs the recovery", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = makeClient({
        uidValidity: 999, // server reassigned UIDs
        exists: 3,
        messages: [
          {
            uid: 1,
            envelope: {
              messageId: "<reset@x>",
              subject: "post-reset",
              from: [{ address: "a@x.com" }],
              date: new Date("2026-05-13T11:00:00Z"),
            },
          },
        ],
      });

      const priorState = {
        organization_id: "org-1",
        account_id: "acc-1",
        folder: "inbox",
        imap_path: "INBOX",
        uid_validity: 100, // stale
        last_uid_seen: 42,
        last_synced_at: "2026-05-13T08:00:00.000Z",
      };

      const result = await syncFolderIncremental({
        client,
        account: { id: "acc-1", organization_id: "org-1" },
        folder: "inbox",
        imapPath: "INBOX",
        state: priorState,
      });

      expect(result.bootstrapped).toBe(true);
      expect(result.newState?.uid_validity).toBe(999);
      expect(result.newState?.last_uid_seen).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[email-sync\] uidvalidity-reset account=acc-1 folder=inbox/,
        ),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns empty + error when mailbox open fails, leaving state untouched", async () => {
    const client: ImapClientLike & {
      mailboxOpen: ReturnType<typeof vi.fn>;
      mailboxClose: ReturnType<typeof vi.fn>;
      fetch: ReturnType<typeof vi.fn>;
    } = {
      mailboxOpen: vi.fn(async () => {
        throw new Error("Mailbox unavailable");
      }),
      mailboxClose: vi.fn(async () => undefined),
      fetch: vi.fn(),
    };

    const result = await syncFolderIncremental({
      client,
      account: { id: "acc-1", organization_id: "org-1" },
      folder: "drafts",
      imapPath: "INBOX.Drafts",
      state: {
        organization_id: "org-1",
        account_id: "acc-1",
        folder: "drafts",
        imap_path: "INBOX.Drafts",
        uid_validity: 50,
        last_uid_seen: 7,
        last_synced_at: "2026-05-13T08:00:00.000Z",
      },
    });

    expect(result.newEmails).toEqual([]);
    expect(result.newState).toBeNull();
    expect(result.bootstrapped).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Mailbox unavailable/);
    expect(client.fetch).not.toHaveBeenCalled();
    expect(client.mailboxClose).not.toHaveBeenCalled();
  });
});
