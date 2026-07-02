"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Globe, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { WebsiteConnectionSummary } from "@/lib/website/types";

// The summary for "no connection" — disconnect deletes the row, and absence of a
// row IS the disconnected state. Built inline rather than imported from
// connection.ts, whose encryption import would pull node:crypto into this client
// bundle. Used to optimistically reflect a successful disconnect without waiting
// on (or trusting) a follow-up refetch.
const DISCONNECTED_SUMMARY: WebsiteConnectionSummary = {
  state: "disconnected",
  provider: null,
  site_url: null,
  username: null,
  account_name: null,
  broken_reason: null,
  connected_at: null,
};

// The Website (WordPress) connection card: one of three states — disconnected
// (the credential form), connected (site + account + Disconnect), or broken (a
// reconnect prompt above the same form). The Application Password is write-only:
// it is posted to the server and never read back — the summary has no password
// field, so the input always starts empty.
export default function WebsiteConnectionCard({
  initial,
}: {
  initial: WebsiteConnectionSummary;
}) {
  const [summary, setSummary] = useState<WebsiteConnectionSummary>(initial);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleConnected(next: WebsiteConnectionSummary) {
    setSummary(next);
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnecting removes the stored WordPress credential from Nookleus. Publishing to your website will stop until you reconnect. (Your WordPress site and its Application Password are untouched — revoke the password in WordPress if you also want to retire it there.)",
      )
    )
      return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/website/disconnect", { method: "POST" });
      if (res.ok) {
        toast.success("Disconnected from your website.");
        // The row is gone server-side — reflect disconnected immediately rather
        // than re-fetching, so a blip on the follow-up GET can't leave the card
        // showing a "connected" credential that no longer exists.
        setSummary(DISCONNECTED_SUMMARY);
      } else {
        toast.error("Couldn't disconnect right now. Please try again.");
      }
    } catch {
      // The request itself failed — server state is unknown, so leave the card
      // connected and let the admin retry rather than wedging the button.
      toast.error("Couldn't reach Nookleus to disconnect. Check your internet and try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg bg-accent-tint flex items-center justify-center shrink-0">
          <Globe size={24} className="text-accent-text" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground">Website</h2>
            <StatusBadge state={summary.state} />
          </div>

          {summary.state === "connected" ? (
            <ConnectedView
              summary={summary}
              disconnecting={disconnecting}
              onDisconnect={handleDisconnect}
            />
          ) : (
            <CredentialForm
              broken={summary.state === "broken"}
              brokenReason={summary.broken_reason}
              siteUrl={summary.site_url}
              username={summary.username}
              onConnected={handleConnected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Turn the connect route's machine error code into a message the admin can act
// on. Each failure points at the thing to fix — a wrong password is not the same
// problem as an account that can't publish or a site that won't respond — so the
// admin isn't left guessing. Unknown codes fall back to the generic prompt.
const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  missing_fields:
    "Fill in your site address, WordPress username, and Application Password.",
  invalid_site_url:
    "That doesn't look like a valid website address. Use your site's full address, e.g. yourcompany.com.",
  invalid_credentials:
    "WordPress rejected that username and Application Password. Generate a fresh Application Password (Users → your profile) and try again.",
  cannot_publish_posts:
    "Those credentials work, but that account can't publish posts. Use a WordPress user with Author, Editor, or Administrator rights.",
  wordpress_unreachable:
    "Couldn't reach your WordPress site to verify the connection. Check the address and that the site is online, then try again.",
};

async function connectErrorMessage(res: Response): Promise<string> {
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // No/!JSON body — fall through to the generic message.
  }
  return (
    (code && CONNECT_ERROR_MESSAGES[code]) ??
    "Couldn't connect to your website. Check the address and credentials, then try again."
  );
}

// The connect/reconnect form. Shown when disconnected or broken. On success it
// hands the returned connected summary back up so the card re-renders connected.
function CredentialForm({
  broken,
  brokenReason,
  siteUrl,
  username,
  onConnected,
}: {
  broken: boolean;
  brokenReason: string | null;
  siteUrl: string | null;
  username: string | null;
  onConnected: (next: WebsiteConnectionSummary) => void;
}) {
  const [siteUrlValue, setSiteUrlValue] = useState(siteUrl ?? "");
  const [usernameValue, setUsernameValue] = useState(username ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/website/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl: siteUrlValue,
          username: usernameValue,
          applicationPassword: password,
        }),
      });
      if (res.ok) {
        const next = (await res.json()) as WebsiteConnectionSummary;
        setPassword("");
        toast.success("Website connected.");
        onConnected(next);
      } else {
        toast.error(await connectErrorMessage(res));
      }
    } catch {
      // The request itself failed (offline, DNS, TLS) — surface it and let the
      // admin retry rather than wedging the button disabled forever.
      toast.error(
        "Couldn't reach your website to verify the connection. Check your internet and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {broken ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Website connection needs reconnecting
            </p>
            <p className="text-sm text-destructive/80 mt-0.5">
              {brokenReason
                ? brokenReason
                : "The Application Password was revoked or changed on WordPress."}{" "}
              Re-enter it below to resume publishing.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mt-1">
          Connect your WordPress site so Nookleus can publish your finished jobs as
          showcase posts. Create an Application Password in WordPress (Users → your
          profile), then paste it below. It&apos;s stored encrypted and never shown
          again.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="wp-site-url"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Website address
          </label>
          <input
            id="wp-site-url"
            type="text"
            inputMode="url"
            placeholder="yourcompany.com"
            value={siteUrlValue}
            onChange={(e) => setSiteUrlValue(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
          />
        </div>
        <div>
          <label
            htmlFor="wp-username"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            WordPress username
          </label>
          <input
            id="wp-username"
            type="text"
            autoComplete="username"
            placeholder="marketing"
            value={usernameValue}
            onChange={(e) => setUsernameValue(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
          />
        </div>
        <div>
          <label
            htmlFor="wp-app-password"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Application Password
          </label>
          <input
            id="wp-app-password"
            type="password"
            autoComplete="off"
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 shadow-sm transition-all disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {broken ? "Reconnect website" : "Connect website"}
        </button>
      </form>
    </>
  );
}

// The connected view: which site/account we're publishing to, and Disconnect.
function ConnectedView({
  summary,
  disconnecting,
  onDisconnect,
}: {
  summary: WebsiteConnectionSummary;
  disconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <>
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <CheckCircle2 size={18} className="text-primary shrink-0" />
        <span className="truncate">
          Connected to {summary.site_url}
          {summary.account_name ? ` as ${summary.account_name}` : ""}
        </span>
      </div>
      {summary.connected_at && (
        <p className="text-xs text-muted-foreground/70 mt-1">
          Linked {new Date(summary.connected_at).toLocaleDateString()}
        </p>
      )}
      <button
        onClick={onDisconnect}
        disabled={disconnecting}
        className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 disabled:opacity-50"
      >
        {disconnecting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
        Disconnect
      </button>
    </>
  );
}

function StatusBadge({ state }: { state: WebsiteConnectionSummary["state"] }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Connected
      </span>
    );
  }
  if (state === "broken") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
        <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> Needs reconnect
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      Not connected
    </span>
  );
}
