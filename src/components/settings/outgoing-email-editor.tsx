"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Save, Send, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import EmailTemplateField from "@/components/contracts/email-template-field";
import PaymentEmailTemplateField from "@/components/settings/payment-email-template-field";
import type {
  ContractEmailProvider,
  ContractEmailSettings,
} from "@/lib/contracts/types";
import type {
  PaymentEmailProvider,
  PaymentEmailSettings,
} from "@/lib/payments/types";
import type { InvoiceEmailSettings } from "@/lib/qb/types";

export type OutgoingEmailKind = "invoice" | "contract" | "payment-link";

interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
}

interface KindConfig<S> {
  endpoint: string;
  title: string;
  description: string;
  loadErrorMessage: string;
  saveSuccessMessage: string;
  renderForm: (
    settings: S,
    accounts: EmailAccount[],
    patch: <K extends keyof S>(key: K, value: S[K]) => void,
  ) => ReactNode;
}

const ACCOUNTS_ENDPOINT = "/api/email/accounts";

export interface OutgoingEmailEditorProps {
  kind: OutgoingEmailKind;
}

export function OutgoingEmailEditor({ kind }: OutgoingEmailEditorProps) {
  if (kind === "invoice") {
    return <Editor config={invoiceConfig} />;
  }
  if (kind === "contract") {
    return <Editor config={contractConfig} />;
  }
  return <Editor config={paymentConfig} />;
}

function Editor<S>({ config }: { config: KindConfig<S> }) {
  const [settings, setSettings] = useState<S | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [settingsRes, accountsRes] = await Promise.all([
      fetch(config.endpoint),
      fetch(ACCOUNTS_ENDPOINT),
    ]);
    if (settingsRes.ok) {
      setSettings((await settingsRes.json()) as S);
    } else {
      toast.error(config.loadErrorMessage);
    }
    if (accountsRes.ok) {
      setAccounts((await accountsRes.json()) as EmailAccount[]);
    }
  }, [config.endpoint, config.loadErrorMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function patch<K extends keyof S>(key: K, value: S[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch(config.endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Save failed");
      }
      setDirty(false);
      toast.success(config.saveSuccessMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Send size={18} className="text-[var(--brand-primary)]" />
            {config.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {config.description}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save
        </button>
      </div>
      {config.renderForm(settings, accounts, patch)}
    </div>
  );
}

// --- Per-kind configs -----------------------------------------------------

const invoiceConfig: KindConfig<InvoiceEmailSettings> = {
  endpoint: "/api/settings/invoice-email",
  title: "Invoice Email Settings",
  description: "Configure how invoice emails are sent and what templates they use.",
  loadErrorMessage: "Failed to load invoice email settings",
  saveSuccessMessage: "Invoice email settings saved",
  renderForm: (settings, accounts, patch) => (
    <>
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Provider</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "resend"}
            onChange={() => patch("provider", "resend")}
          />
          Resend (platform default)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "email_account"}
            onChange={() => patch("provider", "email_account")}
          />
          Send from a connected email account
        </label>
        {settings.provider === "email_account" && (
          <select
            className="border border-border rounded-lg px-3 py-2 bg-background text-sm"
            value={settings.email_account_id ?? ""}
            onChange={(e) => patch("email_account_id", e.target.value || null)}
          >
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.email_address}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            From name
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_name ?? ""}
              onChange={(e) => patch("send_from_name", e.target.value)}
            />
          </label>
          <label className="text-sm">
            From email
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_email ?? ""}
              onChange={(e) => patch("send_from_email", e.target.value)}
            />
          </label>
        </div>
        <label className="text-sm block">
          Reply-to (optional)
          <input
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            value={settings.reply_to_email ?? ""}
            onChange={(e) => patch("reply_to_email", e.target.value)}
          />
        </label>
      </section>

      <section className="bg-card border border-border rounded-xl p-5">
        <EmailTemplateField
          label="Invoice email template"
          description="Sent when you use Send Invoice on a draft."
          subject={settings.subject_template}
          body={settings.body_template}
          onSubjectChange={(v) => patch("subject_template", v)}
          onBodyChange={(v) => patch("body_template", v)}
        />
      </section>
    </>
  ),
};

const contractConfig: KindConfig<ContractEmailSettings> = {
  endpoint: "/api/settings/contract-email",
  title: "Contract Email Settings",
  description: "Controls how contract signing links and confirmation emails are delivered.",
  loadErrorMessage: "Failed to load contract email settings",
  saveSuccessMessage: "Contract email settings saved",
  renderForm: (settings, accounts, patch) => {
    const setupIncomplete = !settings.send_from_email || !settings.send_from_name;
    const offsetsText = settings.reminder_day_offsets.join(", ");
    return (
      <>
        {setupIncomplete && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Finish contract email setup before sending</div>
              <div className="text-xs text-amber-300/80 mt-0.5">
                A send-from email and display name are required. Sends will fail until both are filled in below.
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Send from</h3>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground mb-1">Delivery provider</legend>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
              <input
                type="radio"
                name="provider"
                className="mt-1 accent-[var(--brand-primary)]"
                checked={settings.provider === "resend"}
                onChange={() => patch("provider", "resend" as ContractEmailProvider)}
              />
              <div>
                <div className="text-sm text-foreground font-medium">Resend <span className="text-xs text-muted-foreground font-normal">(recommended)</span></div>
                <div className="text-xs text-muted-foreground">Dedicated transactional email. Requires RESEND_API_KEY and a verified sending domain.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
              <input
                type="radio"
                name="provider"
                className="mt-1 accent-[var(--brand-primary)]"
                checked={settings.provider === "email_account"}
                onChange={() => patch("provider", "email_account" as ContractEmailProvider)}
              />
              <div className="flex-1">
                <div className="text-sm text-foreground font-medium">Use a connected email account</div>
                <div className="text-xs text-muted-foreground">Sends via SMTP through one of the Build 12 email accounts.</div>
                {settings.provider === "email_account" && (
                  <select
                    value={settings.email_account_id ?? ""}
                    onChange={(e) => patch("email_account_id", e.target.value || null)}
                    className="mt-2 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                  >
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} ({a.email_address})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextInput
              label="Send-from email"
              value={settings.send_from_email}
              onChange={(v) => patch("send_from_email", v)}
              placeholder="contracts@yourcompany.com"
              required
            />
            <TextInput
              label="Display name"
              value={settings.send_from_name}
              onChange={(v) => patch("send_from_name", v)}
              placeholder="Your Company"
              required
            />
            <TextInput
              label="Reply-to email (optional)"
              value={settings.reply_to_email ?? ""}
              onChange={(v) => patch("reply_to_email", v || null)}
              placeholder="reply@yourcompany.com"
            />
            <NumberInput
              label="Default link expiry (days)"
              value={settings.default_link_expiry_days}
              onChange={(v) => patch("default_link_expiry_days", Math.max(1, Math.min(30, v)))}
              min={1}
              max={30}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Reminder day offsets</label>
            <input
              type="text"
              value={offsetsText}
              onChange={(e) => {
                const parts = e.target.value
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p) => Number(p))
                  .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
                patch("reminder_day_offsets", parts);
              }}
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              placeholder="1, 3"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Days after send to automatically trigger reminders. Auto-scheduling ships in Build 15c.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Branded card</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Controls the action button and logo on the branded contract emails
              your customers receive. The layout, headline, and footer are drawn
              by Nookleus.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextInput
              label="Button label"
              value={settings.button_label ?? ""}
              onChange={(v) => patch("button_label", v)}
              placeholder="Review & Sign"
            />
            <div>
              <label
                htmlFor="contract-button-color-hex"
                className="text-xs font-medium text-muted-foreground"
              >
                Button color
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Button color swatch"
                  value={
                    /^#[0-9a-fA-F]{6}$/.test(settings.button_color ?? "")
                      ? settings.button_color
                      : "#1f2937"
                  }
                  onChange={(e) => patch("button_color", e.target.value)}
                  className="h-9 w-12 shrink-0 rounded-lg border border-border bg-background/60 cursor-pointer"
                />
                <input
                  id="contract-button-color-hex"
                  type="text"
                  aria-label="Button color hex"
                  value={settings.button_color ?? ""}
                  onChange={(e) => patch("button_color", e.target.value)}
                  placeholder="#1f2937"
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                A 6-digit hex color. The button text auto-adjusts to stay legible.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
            <input
              type="checkbox"
              className="accent-[var(--brand-primary)]"
              checked={settings.logo_visible ?? true}
              onChange={(e) => patch("logo_visible", e.target.checked)}
            />
            <span className="text-sm text-foreground">
              Show my company logo on contract emails
            </span>
          </label>
        </div>

        <EmailTemplateField
          label="Signing request"
          description="First email to the signer with the magic link."
          subject={settings.signing_request_subject_template}
          body={settings.signing_request_body_template}
          onSubjectChange={(v) => patch("signing_request_subject_template", v)}
          onBodyChange={(v) => patch("signing_request_body_template", v)}
        />
        <EmailTemplateField
          label="Signed confirmation — customer"
          description="Sent to the customer after they sign, with the signed PDF attached."
          subject={settings.signed_confirmation_subject_template}
          body={settings.signed_confirmation_body_template}
          onSubjectChange={(v) => patch("signed_confirmation_subject_template", v)}
          onBodyChange={(v) => patch("signed_confirmation_body_template", v)}
        />
        <EmailTemplateField
          label="Signed confirmation — internal"
          description="Sent to your team after a contract is signed, also with the PDF."
          subject={settings.signed_confirmation_internal_subject_template}
          body={settings.signed_confirmation_internal_body_template}
          onSubjectChange={(v) => patch("signed_confirmation_internal_subject_template", v)}
          onBodyChange={(v) => patch("signed_confirmation_internal_body_template", v)}
        />
        <EmailTemplateField
          label="Reminder"
          description="Auto-reminder for unsigned contracts (scheduling lands in Build 15c)."
          subject={settings.reminder_subject_template}
          body={settings.reminder_body_template}
          onSubjectChange={(v) => patch("reminder_subject_template", v)}
          onBodyChange={(v) => patch("reminder_body_template", v)}
        />
      </>
    );
  },
};

const paymentConfig: KindConfig<PaymentEmailSettings> = {
  endpoint: "/api/settings/payment-email",
  title: "Outgoing Email Settings",
  description: "From-address used for payment requests, estimate sends, and invoice sends.",
  loadErrorMessage: "Failed to load payment email settings",
  saveSuccessMessage: "Outgoing email settings saved",
  renderForm: (settings, accounts, patch) => {
    const setupIncomplete = !settings.send_from_email || !settings.send_from_name;
    const offsetsText = settings.reminder_day_offsets.join(", ");
    return (
      <>
        {setupIncomplete && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">
                Finish payment email setup before sending
              </div>
              <div className="text-xs text-amber-300/80 mt-0.5">
                A send-from email and display name are required. Sends will fail
                until both are filled in below.
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Send from</h3>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground mb-1">
              Delivery provider
            </legend>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
              <input
                type="radio"
                name="provider"
                className="mt-1 accent-[var(--brand-primary)]"
                checked={settings.provider === "resend"}
                onChange={() => patch("provider", "resend" as PaymentEmailProvider)}
              />
              <div>
                <div className="text-sm text-foreground font-medium">
                  Resend{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    (recommended)
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Dedicated transactional email. Requires RESEND_API_KEY and a
                  verified sending domain.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
              <input
                type="radio"
                name="provider"
                className="mt-1 accent-[var(--brand-primary)]"
                checked={settings.provider === "email_account"}
                onChange={() =>
                  patch("provider", "email_account" as PaymentEmailProvider)
                }
              />
              <div className="flex-1">
                <div className="text-sm text-foreground font-medium">
                  Use a connected email account
                </div>
                <div className="text-xs text-muted-foreground">
                  Sends via SMTP through one of the Build 12 email accounts.
                </div>
                {settings.provider === "email_account" && (
                  <select
                    value={settings.email_account_id ?? ""}
                    onChange={(e) =>
                      patch("email_account_id", e.target.value || null)
                    }
                    className="mt-2 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                  >
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} ({a.email_address})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextInput
              label="Send-from email"
              value={settings.send_from_email}
              onChange={(v) => patch("send_from_email", v)}
              placeholder="payments@yourcompany.com"
              required
            />
            <TextInput
              label="Display name"
              value={settings.send_from_name}
              onChange={(v) => patch("send_from_name", v)}
              placeholder="Your Company"
              required
            />
            <TextInput
              label="Reply-to email (optional)"
              value={settings.reply_to_email ?? ""}
              onChange={(v) => patch("reply_to_email", v || null)}
              placeholder="reply@yourcompany.com"
            />
            <NumberInput
              label="Default link expiry (days)"
              value={settings.default_link_expiry_days}
              onChange={(v) =>
                patch(
                  "default_link_expiry_days",
                  Math.max(1, Math.min(30, v)),
                )
              }
              min={1}
              max={30}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Reminder day offsets
            </label>
            <input
              type="text"
              value={offsetsText}
              onChange={(e) => {
                const parts = e.target.value
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p) => Number(p))
                  .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
                patch("reminder_day_offsets", parts);
              }}
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              placeholder="3, 7"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Days after send when automatic reminders are triggered. Default: 3, 7. Scheduler ships in 17d.
            </p>
          </div>
        </div>

        <PaymentEmailTemplateField
          label="Payment request"
          description="First email to the customer with the Stripe payment link."
          subject={settings.payment_request_subject_template}
          body={settings.payment_request_body_template}
          onSubjectChange={(v) => patch("payment_request_subject_template", v)}
          onBodyChange={(v) => patch("payment_request_body_template", v)}
        />
        <PaymentEmailTemplateField
          label="Payment reminder"
          description="Auto-reminder for unpaid requests (scheduling lands in 17d)."
          subject={settings.payment_reminder_subject_template}
          body={settings.payment_reminder_body_template}
          onSubjectChange={(v) => patch("payment_reminder_subject_template", v)}
          onBodyChange={(v) => patch("payment_reminder_body_template", v)}
        />

        <PaymentEmailTemplateField
          label="Customer Receipt"
          description="Sent to the customer when their payment is confirmed. A branded PDF is attached automatically."
          subject={settings.payment_receipt_subject_template}
          body={settings.payment_receipt_body_template}
          onSubjectChange={(v) => patch("payment_receipt_subject_template", v)}
          onBodyChange={(v) => patch("payment_receipt_body_template", v)}
        />

        <PaymentEmailTemplateField
          label="Refund Confirmation (to customer)"
          description="Sent to the customer after Stripe confirms a refund you initiated."
          subject={settings.refund_confirmation_subject_template}
          body={settings.refund_confirmation_body_template}
          onSubjectChange={(v) =>
            patch("refund_confirmation_subject_template", v)
          }
          onBodyChange={(v) => patch("refund_confirmation_body_template", v)}
        />

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Internal Notifications
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Emails sent to your team when payments succeed, fail, or are
              refunded. Leave the address blank to send to the same send-from
              address.
            </p>
          </div>
          <TextInput
            label="Notification recipient email"
            value={settings.internal_notification_to_email ?? ""}
            onChange={(v) => patch("internal_notification_to_email", v || null)}
            placeholder="team@example.com (defaults to the send-from address)"
          />
        </div>

        <PaymentEmailTemplateField
          label="Payment Received"
          description="Internal alert when a customer payment succeeds."
          subject={settings.payment_received_internal_subject_template}
          body={settings.payment_received_internal_body_template}
          onSubjectChange={(v) =>
            patch("payment_received_internal_subject_template", v)
          }
          onBodyChange={(v) =>
            patch("payment_received_internal_body_template", v)
          }
        />
        <PaymentEmailTemplateField
          label="Payment Failed"
          description="Internal alert when a customer payment attempt fails."
          subject={settings.payment_failed_internal_subject_template}
          body={settings.payment_failed_internal_body_template}
          onSubjectChange={(v) =>
            patch("payment_failed_internal_subject_template", v)
          }
          onBodyChange={(v) => patch("payment_failed_internal_body_template", v)}
        />
        <PaymentEmailTemplateField
          label="Refund Issued"
          description="Internal alert when a refund you initiated is confirmed by Stripe."
          subject={settings.refund_issued_internal_subject_template}
          body={settings.refund_issued_internal_body_template}
          onSubjectChange={(v) =>
            patch("refund_issued_internal_subject_template", v)
          }
          onBodyChange={(v) => patch("refund_issued_internal_body_template", v)}
        />

        <PaymentEmailTemplateField
          label="Estimate send"
          description="Sent to the customer when you email an estimate from the read-only view. The selected PDF preset is attached automatically."
          subject={settings.estimate_send_subject_template}
          body={settings.estimate_send_body_template}
          onSubjectChange={(v) => patch("estimate_send_subject_template", v)}
          onBodyChange={(v) => patch("estimate_send_body_template", v)}
        />
        <PaymentEmailTemplateField
          label="Invoice send"
          description="Sent to the customer when you email an invoice from the read-only view. The selected PDF preset is attached automatically."
          subject={settings.invoice_send_subject_template}
          body={settings.invoice_send_body_template}
          onSubjectChange={(v) => patch("invoice_send_subject_template", v)}
          onBodyChange={(v) => patch("invoice_send_body_template", v)}
        />

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Card payment fee disclosure
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shown below the Card payment button on the customer payment page
              when card surcharge is enabled. Required by state law in some
              jurisdictions.
            </p>
          </div>
          <textarea
            value={settings.fee_disclosure_text ?? ""}
            onChange={(e) =>
              patch("fee_disclosure_text", e.target.value || null)
            }
            rows={3}
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            placeholder="A 3% service fee applies to card payments..."
          />
        </div>
      </>
    );
  },
};

// --- Shared inputs --------------------------------------------------------

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-amber-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}
