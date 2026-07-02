"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Copy, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StripeConnectionRow } from "@/lib/stripe";

interface Props {
  initialConnection: StripeConnectionRow | null;
  webhookConfigured: boolean;
  lastEventAt: string | null;
}

function useDebouncedPatch(setConnection: (c: StripeConnectionRow | null) => void) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);
  return useCallback(
    (field: string, value: unknown, delay = 600) => {
      const existing = timers.current.get(field);
      if (existing) clearTimeout(existing);
      const t = setTimeout(async () => {
        timers.current.delete(field);
        const res = await fetch("/api/stripe/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          toast.error(error ?? "Failed to save");
          return;
        }
        const { connection } = (await res.json()) as { connection: StripeConnectionRow };
        setConnection(connection);
        toast.success("Saved", { id: "stripe-settings-save" });
      }, delay);
      timers.current.set(field, t);
    },
    [setConnection],
  );
}

const DEFAULT_SURCHARGE_DISCLOSURE =
  "We add a surcharge to card payments that is not greater than our cost of acceptance. We do not surcharge ACH/bank payments.";

export default function StripeSettingsClient({
  initialConnection,
  webhookConfigured,
  lastEventAt,
}: Props) {
  const [connection, setConnection] = useState<StripeConnectionRow | null>(initialConnection);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Local drafts for text/number inputs so their values are controlled locally
  // instead of via `defaultValue` (which warns when the underlying prop shifts
  // after each debounced save).
  const [descriptorDraft, setDescriptorDraft] = useState(
    initialConnection?.default_statement_descriptor ?? "",
  );
  const [cardFeePercentDraft, setCardFeePercentDraft] = useState<number>(
    initialConnection?.card_fee_percent ?? 3,
  );
  const [surchargeDisclosureDraft, setSurchargeDisclosureDraft] = useState<string>(
    initialConnection?.surcharge_disclosure ?? DEFAULT_SURCHARGE_DISCLOSURE,
  );
  const [achThresholdDraft, setAchThresholdDraft] = useState<number>(
    initialConnection?.ach_preferred_threshold ?? 5000,
  );
  const patch = useDebouncedPatch(setConnection);

  const onConnect = () => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/stripe/connect/start";
    document.body.appendChild(form);
    form.submit();
  };

  const onDisconnect = async () => {
    const res = await fetch("/api/stripe/disconnect", { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    setConnection(null);
    setDisconnectOpen(false);
    toast.success("Disconnected");
  };

  const onCopyAccountId = async () => {
    if (!connection) return;
    await navigator.clipboard.writeText(connection.stripe_account_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!connection) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Stripe Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Connect your Stripe account to accept online card and ACH payments for
              invoices and deposits. Credentials are stored encrypted in your database —
              never in configuration files.
            </p>
            <Button onClick={onConnect} size="lg">
              Connect Stripe Account
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const truncatedAccount = `${connection.stripe_account_id.slice(0, 10)}…${connection.stripe_account_id.slice(-4)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Stripe Payments
            <Badge
              variant={connection.mode === "live" ? "default" : "secondary"}
              className={
                connection.mode === "live"
                  ? ""
                  : "bg-warning/10 text-warning"
              }
            >
              {connection.mode === "live" ? "Live" : "Test"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Stripe account</div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span>{truncatedAccount}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onCopyAccountId}
                  aria-label={copied ? "Copied" : "Copy account ID"}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descriptor">Statement descriptor</Label>
            <Input
              id="descriptor"
              value={descriptorDraft}
              maxLength={22}
              placeholder="e.g. AAA CONTRACTING"
              onChange={(e) => {
                const v = e.target.value.slice(0, 22);
                setDescriptorDraft(v);
                patch("default_statement_descriptor", v || null, 1200);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Up to 22 characters. Appears on your customers&rsquo; bank statements.
            </p>
          </div>

          {connection.last_connected_at && (
            <p className="text-sm text-muted-foreground">
              Connected{" "}
              {formatDistanceToNow(new Date(connection.last_connected_at), { addSuffix: true })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment method toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Payment methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ach_enabled">ACH (US bank) payments</Label>
              <p className="text-xs text-muted-foreground">
                Low fees; typically 0.8% capped at $5. Best for large invoices.
              </p>
            </div>
            <Switch
              id="ach_enabled"
              checked={connection.ach_enabled}
              onCheckedChange={(v) => {
                if (!v && !connection.card_enabled) {
                  toast.error("At least one payment method must be enabled");
                  return;
                }
                setConnection({ ...connection, ach_enabled: v });
                patch("ach_enabled", v, 50);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="card_enabled">Card payments</Label>
              <p className="text-xs text-muted-foreground">
                Instant; ~2.9% + 30&cent; per transaction.
              </p>
            </div>
            <Switch
              id="card_enabled"
              checked={connection.card_enabled}
              onCheckedChange={(v) => {
                if (!v && !connection.ach_enabled) {
                  toast.error("At least one payment method must be enabled");
                  return;
                }
                setConnection({ ...connection, card_enabled: v });
                patch("card_enabled", v, 50);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Card surcharge */}
      <Card>
        <CardHeader>
          <CardTitle>Card processing fee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pass_card_fee">Pass card processing fee to customer</Label>
              <p className="text-xs text-muted-foreground">
                Adds a surcharge line on card-paid invoices. Confirm legality in your jurisdiction.
              </p>
            </div>
            <Switch
              id="pass_card_fee"
              checked={connection.pass_card_fee_to_customer}
              onCheckedChange={(v) => {
                setConnection({ ...connection, pass_card_fee_to_customer: v });
                patch("pass_card_fee_to_customer", v, 50);
              }}
            />
          </div>
          {connection.pass_card_fee_to_customer && (
            <>
              <div className="space-y-2">
                <Label htmlFor="card_fee_percent">Surcharge percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="card_fee_percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="5"
                    value={cardFeePercentDraft}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setCardFeePercentDraft(e.target.value === "" ? 0 : v);
                      if (Number.isFinite(v) && v >= 0 && v <= 5) {
                        patch("card_fee_percent", v, 1200);
                      }
                    }}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Preview: $1,000 invoice would charge $
                  {(1000 + (1000 * cardFeePercentDraft) / 100).toFixed(2)} on card.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="surcharge_disclosure">Surcharge disclosure</Label>
                <textarea
                  id="surcharge_disclosure"
                  className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={surchargeDisclosureDraft}
                  onChange={(e) => {
                    setSurchargeDisclosureDraft(e.target.value);
                    patch("surcharge_disclosure", e.target.value || null, 1200);
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ACH threshold */}
      <Card>
        <CardHeader>
          <CardTitle>ACH for large payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ach_threshold_enabled">
                Require ACH at or above a threshold
              </Label>
              <p className="text-xs text-muted-foreground">
                Hides the card option for payments at or above this amount.
              </p>
            </div>
            <Switch
              id="ach_threshold_enabled"
              checked={connection.ach_preferred_threshold != null}
              onCheckedChange={(v) => {
                const next = v ? achThresholdDraft || 5000 : null;
                if (v) setAchThresholdDraft(next as number);
                setConnection({ ...connection, ach_preferred_threshold: next });
                patch("ach_preferred_threshold", next, 50);
              }}
            />
          </div>
          {connection.ach_preferred_threshold != null && (
            <div className="space-y-2">
              <Label htmlFor="ach_threshold">Amount ($)</Label>
              <Input
                id="ach_threshold"
                type="number"
                step="1"
                min="0"
                value={achThresholdDraft}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAchThresholdDraft(e.target.value === "" ? 0 : v);
                  if (Number.isFinite(v) && v >= 0) patch("ach_preferred_threshold", v, 1200);
                }}
                className="w-32"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <WebhookConfigSection
            configured={webhookConfigured}
            lastEventAt={lastEventAt}
            mode={connection.mode}
          />
        </CardContent>
      </Card>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Stripe?</DialogTitle>
            <DialogDescription>
              This will clear your encrypted Stripe credentials. Existing payment records are
              preserved. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebhookConfigSection({
  configured,
  lastEventAt,
  mode,
}: {
  configured: boolean;
  lastEventAt: string | null;
  mode: "test" | "live";
}) {
  const dashboardUrl =
    mode === "live"
      ? "https://dashboard.stripe.com/webhooks"
      : "https://dashboard.stripe.com/test/webhooks";
  const router = useRouter();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appUrl, setAppUrl] = useState("");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/stripe/webhook-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: value || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Failed to save webhook secret");
      return;
    }
    toast.success(value ? "Webhook secret saved" : "Webhook secret cleared");
    setDirty(false);
    setValue("");
    router.refresh();
  };

  const statusBadge = (() => {
    if (!configured)
      return (
        <Badge className="bg-destructive/10 text-destructive">
          No webhook configured
        </Badge>
      );
    if (!lastEventAt)
      return (
        <Badge className="bg-warning/10 text-warning">
          Configured — no events received yet
        </Badge>
      );
    const diff = Date.now() - new Date(lastEventAt).getTime();
    const readable =
      diff < 60_000
        ? "just now"
        : diff < 3_600_000
          ? `${Math.floor(diff / 60_000)}m ago`
          : diff < 86_400_000
            ? `${Math.floor(diff / 3_600_000)}h ago`
            : `${Math.floor(diff / 86_400_000)}d ago`;
    return (
      <Badge className="bg-primary/10 text-primary">
        Configured — last event {readable}
      </Badge>
    );
  })();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Status</p>
        {statusBadge}
      </div>
      <p className="text-sm text-muted-foreground">
        Stripe uses a webhook to tell this app when a payment succeeds, fails,
        is refunded, or disputed. Create a webhook in your{" "}
        <a
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
          href={dashboardUrl}
        >
          Stripe Dashboard
        </a>{" "}
        pointing to <code>{appUrl}/api/stripe/webhook</code> and subscribe to
        these events:
      </p>
      <ul className="list-disc pl-6 text-xs text-muted-foreground">
        <li>checkout.session.completed</li>
        <li>payment_intent.succeeded</li>
        <li>payment_intent.payment_failed</li>
        <li>charge.refunded</li>
        <li>charge.dispute.created</li>
        <li>charge.dispute.closed</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Then copy that endpoint&rsquo;s signing secret (starts with{" "}
        <code>whsec_</code>) and paste it below.
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor="webhook_secret" className="sr-only">
          Webhook signing secret
        </Label>
        <Input
          id="webhook_secret"
          type={reveal ? "text" : "password"}
          placeholder={
            configured ? "whsec_•••••  (paste to replace)" : "whsec_..."
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "Hide webhook signing secret" : "Show webhook signing secret"}
          aria-pressed={reveal}
        >
          {reveal ? "Hide" : "Show"}
        </Button>
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
