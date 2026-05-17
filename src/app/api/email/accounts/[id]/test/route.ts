import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { decrypt } from "@/lib/encryption";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

// POST /api/email/accounts/[id]/test — test IMAP and SMTP connections.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const POST = withRequestContext(
  {},
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: account, error } = await ctx.supabase
      .from("email_accounts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    let password: string;
    try {
      password = decrypt(account.encrypted_password);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to decrypt password: ${err instanceof Error ? err.message : "check ENCRYPTION_KEY"}` },
        { status: 500 }
      );
    }

    const results = { imap: false, smtp: false, imapError: "", smtpError: "" };

    // Test IMAP
    try {
      const client = new ImapFlow({
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_port === 993,
        auth: { user: account.username, pass: password },
        logger: false,
        tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
      });
      await client.connect();
      await client.logout();
      results.imap = true;
    } catch (err) {
      results.imapError = err instanceof Error ? err.message : "IMAP connection failed";
    }

    // Test SMTP
    try {
      const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.username, pass: password },
        tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true" },
      });
      await transporter.verify();
      transporter.close();
      results.smtp = true;
    } catch (err) {
      results.smtpError = err instanceof Error ? err.message : "SMTP connection failed";
    }

    return NextResponse.json(results);
  },
);
