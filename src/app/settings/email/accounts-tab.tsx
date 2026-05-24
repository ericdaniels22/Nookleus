"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Mail,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  ArrowLeft,
  RefreshCw,
  Pencil,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";
import { EMAIL_PROVIDERS } from "@/lib/types";
import {
  ACCOUNT_COLOR_PALETTE,
  ACCOUNT_COLOR_FALLBACK,
} from "@/lib/email/assign-account-color";
import { useAuth } from "@/lib/auth-context";

interface EmailAccount {
  id: string;
  // null marks a Shared (org-wide) account; a uuid marks a Personal
  // account owned by that user. Drives the "Shared" vs "Owner: X" label.
  user_id: string | null;
  label: string;
  email_address: string;
  display_name: string;
  provider: string;
  signature: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  is_active: boolean;
  is_default: boolean;
  color: string | null;
  last_synced_at: string | null;
  created_at: string;
}

// A member of the active Organization — enough to label a Personal
// account's owner and to populate the connect dialog's Owner picker.
interface OrgMember {
  id: string;
  full_name: string;
  email: string;
}

export function AccountsTab() {
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  // Owner picked in the connect dialog: "" means Shared (no owner).
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { imap: boolean; smtp: boolean; imapError: string; smtpError: string }>>({});
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, { total_synced: number; total_matched: number; error?: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ label: "", display_name: "", signature: "", password: "" });

  // Form state
  const [form, setForm] = useState({
    label: "",
    email_address: "",
    display_name: "AAA Disaster Recovery",
    provider: "hostinger",
    imap_host: "imap.hostinger.com",
    imap_port: 993,
    smtp_host: "smtp.hostinger.com",
    smtp_port: 465,
    username: "",
    password: "",
  });

  function handleProviderChange(provider: string) {
    const preset = EMAIL_PROVIDERS[provider];
    if (preset) {
      setForm((prev) => ({
        ...prev,
        provider,
        imap_host: preset.imap_host || prev.imap_host,
        imap_port: preset.imap_port,
        smtp_host: preset.smtp_host || prev.smtp_host,
        smtp_port: preset.smtp_port,
      }));
    }
  }

  // An admin manages every account in the Organization, including Personal
  // accounts owned by others — that needs the Service-client admin view
  // (?asAdmin=true). A non-admin gets the default view: the accounts they
  // can read (Shared plus their own Personal), which is all they may touch.
  const accountsUrl = isAdmin
    ? "/api/email/accounts?asAdmin=true"
    : "/api/email/accounts";

  // Re-run by the connect / edit / delete / sync handlers to refresh the
  // list after a mutation. The initial load lives in the effect below.
  const fetchAccounts = useCallback(async () => {
    const res = await fetch(accountsUrl);
    if (res.ok) {
      const data = await res.json();
      setAccounts(data);
    }
    setLoading(false);
  }, [accountsUrl]);

  // Initial account load. Wait for auth to resolve first — the chosen view
  // hinges on the caller's role.
  useEffect(() => {
    if (authLoading) return;
    fetch(accountsUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setAccounts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [authLoading, accountsUrl]);

  // Member list — only an admin needs it: to resolve a Personal account's
  // "Owner: X" label and to populate the connect dialog's Owner picker. A
  // non-admin only ever sees Shared accounts plus their own Personal one,
  // so their own profile is enough and /api/settings/users is never hit.
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    fetch("/api/settings/users")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!Array.isArray(data)) return;
        setMembers(
          data.map((m: { id: string; full_name?: string; email?: string }) => ({
            id: m.id,
            full_name: m.full_name || m.email || "Unknown",
            email: m.email || "",
          })),
        );
      })
      .catch(() => {});
  }, [authLoading, isAdmin]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // Owner of the new account. An admin's choice comes from the Owner
    // picker ("" → Shared, i.e. no owner). A non-admin has no picker and is
    // always the owner of what they connect — the route enforces this too.
    const owner = isAdmin ? ownerId || null : profile?.id ?? null;
    const res = await fetch("/api/email/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        username: form.username || form.email_address,
        user_id: owner,
      }),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({
        label: "",
        email_address: "",
        display_name: "AAA Disaster Recovery",
        provider: "hostinger",
        imap_host: "imap.hostinger.com",
        imap_port: 993,
        smtp_host: "smtp.hostinger.com",
        smtp_port: 465,
        username: "",
        password: "",
      });
      setOwnerId("");
      fetchAccounts();
    }
    setSaving(false);
  }

  function startEditing(account: EmailAccount) {
    setEditingId(account.id);
    setEditValues({ label: account.label, display_name: account.display_name || "", signature: account.signature || "", password: "" });
  }

  async function handleSaveEdit(id: string) {
    const payload: Record<string, string> = {
      label: editValues.label,
      display_name: editValues.display_name,
      signature: editValues.signature,
    };
    if (editValues.password) {
      payload.password = editValues.password;
    }
    await fetch(`/api/email/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditingId(null);
    fetchAccounts();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this email account?")) return;
    await fetch(`/api/email/accounts/${id}`, { method: "DELETE" });
    fetchAccounts();
  }

  async function updateColor(id: string, color: string) {
    // Optimistic update so the swatch reflects immediately.
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, color } : a)));
    await fetch(`/api/email/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    setSyncResults((prev) => ({ ...prev, [id]: undefined as never }));
    try {
      const res = await fetch("/api/email/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResults((prev) => ({ ...prev, [id]: data }));
      } else {
        setSyncResults((prev) => ({ ...prev, [id]: { total_synced: data.total_synced || 0, total_matched: data.total_matched || 0, error: data.error } }));
      }
      fetchAccounts(); // refresh last_synced_at
    } catch {
      setSyncResults((prev) => ({ ...prev, [id]: { total_synced: 0, total_matched: 0, error: "Network error" } }));
    }
    setSyncingId(null);
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: undefined as never }));
    const res = await fetch(`/api/email/accounts/${id}/test`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
    }
    setTestingId(null);
  }

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, m.full_name);
    return map;
  }, [members]);

  // Display name for a Personal account's owner. An admin resolves any
  // member via the member list; a non-admin only ever sees their own
  // Personal account, so their profile covers it.
  function ownerLabel(userId: string): string {
    return (
      memberNameById.get(userId) ??
      (profile && userId === profile.id ? profile.full_name : "Unknown")
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/email"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft size={14} /> Back to Email
        </Link>
        <h1 className="text-3xl font-extrabold text-foreground flex items-center gap-2">
          <Mail size={24} /> Email Accounts
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect your email accounts to sync and send emails from jobs.
        </p>
      </div>

      {/* Existing accounts */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground/60">Loading...</div>
      ) : (
        <div className="space-y-4 mb-6">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="bg-card rounded-xl border border-border p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mail size={20} className="text-primary" />
                  </div>
                  {editingId === account.id ? (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-muted-foreground/60 mb-0.5">Label</label>
                        <input
                          type="text"
                          value={editValues.label}
                          onChange={(e) => setEditValues({ ...editValues, label: e.target.value })}
                          className="border border-border rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground/60 mb-0.5">Display Name (From field)</label>
                        <input
                          type="text"
                          value={editValues.display_name}
                          onChange={(e) => setEditValues({ ...editValues, display_name: e.target.value })}
                          className="border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground/60 mb-0.5">Email Signature</label>
                        <textarea
                          value={editValues.signature}
                          onChange={(e) => setEditValues({ ...editValues, signature: e.target.value })}
                          placeholder="Eric Daniels&#10;AAA Disaster Recovery&#10;(512) 555-1234"
                          rows={4}
                          className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground/60 mb-0.5">Password <span className="text-muted-foreground/40">(leave blank to keep current)</span></label>
                        <input
                          type="password"
                          value={editValues.password}
                          onChange={(e) => setEditValues({ ...editValues, password: e.target.value })}
                          placeholder="••••••••"
                          className="border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveEdit(account.id)}
                          className="flex items-center gap-1 text-xs font-medium text-green-700 hover:underline"
                        >
                          <Check size={14} /> Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:underline"
                        >
                          <X size={14} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{account.label}</p>
                        <button
                          onClick={() => startEditing(account)}
                          className="text-muted-foreground/60 hover:text-primary"
                          title="Edit account"
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                      <p className="text-sm text-muted-foreground">{account.email_address}</p>
                      {account.display_name && (
                        <p className="text-xs text-muted-foreground/60">Sends as: {account.display_name}</p>
                      )}
                      {/* Account kind — a Shared account carries no owner;
                          a Personal account names the member who owns it. */}
                      {account.user_id === null ? (
                        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 mt-1 rounded-full bg-blue-50 text-blue-700">
                          Shared
                        </span>
                      ) : (
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Owner: {ownerLabel(account.user_id)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                      account.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${account.is_active ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                    {account.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              {/* Server details */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Server size={12} />
                  IMAP: {account.imap_host}:{account.imap_port}
                </div>
                <div className="flex items-center gap-1.5">
                  <Server size={12} />
                  SMTP: {account.smtp_host}:{account.smtp_port}
                </div>
              </div>

              {/* Color indicator picker — drives the inbox bar in /email when 2+
                  active accounts are connected. */}
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs text-muted-foreground/60">Color</span>
                <div className="flex items-center gap-1.5">
                  {ACCOUNT_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateColor(account.id, c)}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                        account.color === c
                          ? "border-foreground"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                      aria-label={`Set color to ${c}`}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  value={account.color ?? ACCOUNT_COLOR_FALLBACK}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                      updateColor(account.id, v);
                    } else {
                      // Allow editing the field to be in-progress; only
                      // commit when it parses as a full hex.
                      setAccounts((prev) =>
                        prev.map((a) =>
                          a.id === account.id ? { ...a, color: v } : a,
                        ),
                      );
                    }
                  }}
                  maxLength={7}
                  className="w-20 px-2 py-1 text-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label="Hex color"
                />
              </div>

              {account.last_synced_at && (
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Last synced: {new Date(account.last_synced_at).toLocaleString()}
                </p>
              )}

              {/* Test results */}
              {testResults[account.id] && (
                <div className="mt-3 p-3 rounded-lg bg-muted space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    {testResults[account.id].imap ? (
                      <CheckCircle2 size={16} className="text-green-600" />
                    ) : (
                      <XCircle size={16} className="text-red-600" />
                    )}
                    <span>
                      IMAP: {testResults[account.id].imap ? "Connected" : testResults[account.id].imapError}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {testResults[account.id].smtp ? (
                      <CheckCircle2 size={16} className="text-green-600" />
                    ) : (
                      <XCircle size={16} className="text-red-600" />
                    )}
                    <span>
                      SMTP: {testResults[account.id].smtp ? "Connected" : testResults[account.id].smtpError}
                    </span>
                  </div>
                </div>
              )}

              {/* Sync results */}
              {syncResults[account.id] && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${syncResults[account.id].error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                  {syncResults[account.id].error ? (
                    <p>Sync error: {syncResults[account.id].error}</p>
                  ) : (
                    <p>
                      Synced {syncResults[account.id].total_synced} new emails, {syncResults[account.id].total_matched} matched to jobs.
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => handleSync(account.id)}
                  disabled={syncingId === account.id}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                >
                  {syncingId === account.id ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} /> Sync Now
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleTest(account.id)}
                  disabled={testingId === account.id}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                >
                  {testingId === account.id ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </button>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-sm font-medium text-red-600 hover:underline flex items-center gap-1"
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </div>
          ))}

          {accounts.length === 0 && !showForm && (
            <div className="text-center py-12 bg-card rounded-xl border border-border">
              <Mail size={40} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground/60">No email accounts connected.</p>
              <p className="text-sm text-muted-foreground/40 mt-1">
                Add an account to start syncing emails with your jobs.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Add account form */}
      {showForm ? (
        <form
          onSubmit={handleAdd}
          className="bg-card rounded-xl border border-border p-6 space-y-4"
        >
          <h3 className="font-semibold text-foreground text-lg">Add Email Account</h3>

          {/* Provider preset */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Email Provider
            </label>
            <select
              value={form.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {Object.entries(EMAIL_PROVIDERS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>

          {/* Owner — admins only. An admin may connect a Shared account
              (no owner) or a Personal account on behalf of any member.
              A non-admin has no picker; they are auto-assigned as owner. */}
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Owner
              </label>
              <select
                aria-label="Owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">Shared — entire organization</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Label
              </label>
              <input
                type="text"
                placeholder="e.g. Main Office"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="eric@aaadisasterrecovery.com"
                value={form.email_address}
                onChange={(e) => setForm({ ...form, email_address: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Display Name <span className="text-muted-foreground/60 font-normal">(shown in From field)</span>
            </label>
            <input
              type="text"
              placeholder="AAA Disaster Recovery"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Username <span className="text-muted-foreground/60 font-normal">(defaults to email)</span>
              </label>
              <input
                type="text"
                placeholder="Same as email address"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          {/* Server settings (collapsible with defaults) */}
          <details className="text-sm">
            <summary className="cursor-pointer text-primary font-medium">
              Server Settings (auto-filled from provider)
            </summary>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">IMAP Host</label>
                <input
                  type="text"
                  value={form.imap_host}
                  onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">IMAP Port</label>
                <input
                  type="number"
                  value={form.imap_port}
                  onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">SMTP Host</label>
                <input
                  type="text"
                  value={form.smtp_host}
                  onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">SMTP Port</label>
                <input
                  type="number"
                  value={form.smtp_port}
                  onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
          </details>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[image:var(--gradient-primary)] text-white rounded-lg text-sm font-medium shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 flex items-center gap-2 transition-all"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add Account
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="px-5 py-2.5 bg-[image:var(--gradient-primary)] text-white rounded-lg text-sm font-medium shadow-sm hover:brightness-110 hover:shadow-md flex items-center gap-2 transition-all"
        >
          <Plus size={16} /> Add Email Account
        </button>
      )}
    </div>
  );
}
