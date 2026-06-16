import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

// nodemailer (SMTP) and decrypt (crypto) are the only true externals on the
// happy path — mock them at the boundary so the test exercises the real route
// plus the real sanitizer end to end. `vi.hoisted` lets the factory close over
// `sendMail` despite vi.mock being hoisted above this line.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail, close: vi.fn() }) },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: () => "smtp-password",
  encrypt: (s: string) => s,
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

type Account = {
  id: string;
  organization_id: string;
  user_id: string | null;
};

const noParams = { params: Promise.resolve({}) };

function withAccounts(accounts: Account[]) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { email_accounts: accounts } }) as never,
  );
}

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function postReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const COMPLETE_BODY = {
  to: "customer@example.com",
  subject: "Hello",
  body: "Hi",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// PRD #134: "send treated the same as canRead for now" — until that splits,
// the access matrix uses canRead for /send. Owners of a Personal account
// can send from it; view_email holders can send from Shared; admins cannot
// send from a Personal account they do not own (canRead false).
describe("POST /api/email/send — gated on view_email + canRead per account (#141)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds no email permission", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(403);
  });

  it("returns 400 when the caller passes the gate but the body omits required fields", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });

    const res = await POST(postReq(), noParams);

    expect(res.status).toBe(400);
  });

  it("returns 404 for an accountId in a different Organization", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-2", user_id: null }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 for a Personal accountId owned by someone else (non-admin caller)", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_email"],
      }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when an admin tries to send from a Personal account they don't own (canRead=false)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: "user-2" }]);

    const res = await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1" }),
      noParams,
    );

    expect(res.status).toBe(403);
  });
});

// Issue #658 M3/L5: /send is the real outgoing-email boundary. Body HTML POSTed
// directly here bypasses the client Tiptap round-trip entirely, so it must be
// allowlist-sanitized before it goes out over SMTP *and* before the sent copy
// is stored — and the internal signature round-trip markers (data-signature-
// block) must be stripped from what actually leaves the building (L5), while
// the visible signature text and its styling survive.
describe("POST /api/email/send — sanitizes outgoing + stored HTML", () => {
  const sharedAccount = {
    id: "acc-1",
    organization_id: "org-1",
    user_id: null,
    email_address: "me@org.com",
    display_name: "Me",
    smtp_host: "smtp.test",
    smtp_port: 587,
    username: "me@org.com",
    encrypted_password: "enc",
  };

  const DIRTY_HTML =
    "<p>Hi</p><script>steal()</script>" +
    '<div data-signature-block="true" style="border-top:1px solid #ccc"><p>Sig</p></div>';

  it("strips script + internal markers from the SMTP html and the stored copy", async () => {
    sendMail.mockResolvedValue({ messageId: "msg-1" });
    const writes: Array<{ table: string; payload: Record<string, unknown> }> = [];

    // Shared account → a view_email holder canRead it, so the route reaches
    // the actual send.
    withAccounts([{ id: "acc-1", organization_id: "org-1", user_id: null }]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: {
          ...memberTables({ userId: "user-1", role: "crew_lead", grants: ["view_email"] }),
          email_accounts: [sharedAccount],
          emails: [{ id: "sent-1" }],
        },
        onWrite: (table, _op, payload) =>
          writes.push({ table, payload: payload as Record<string, unknown> }),
      }) as never,
    );

    await POST(
      postReq({ ...COMPLETE_BODY, accountId: "acc-1", bodyHtml: DIRTY_HTML }),
      noParams,
    );

    // What actually went out over SMTP.
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sentHtml = (sendMail.mock.calls[0][0] as { html: string }).html;
    expect(sentHtml).not.toContain("<script");
    expect(sentHtml).not.toContain("steal");
    expect(sentHtml).not.toContain("data-signature-block");
    expect(sentHtml).toContain("Sig"); // visible signature text survives
    expect(sentHtml).toContain("border-top"); // signature styling survives

    // The stored sent copy mirrors what was actually sent — same sanitization.
    const stored = writes.find((w) => w.table === "emails");
    expect(stored).toBeTruthy();
    const storedHtml = stored!.payload.body_html as string;
    expect(storedHtml).not.toContain("<script");
    expect(storedHtml).not.toContain("data-signature-block");
    expect(storedHtml).toContain("Sig");
  });
});
