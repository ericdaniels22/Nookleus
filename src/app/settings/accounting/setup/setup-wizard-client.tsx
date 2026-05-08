"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { QbAccount, QbClass, QbMappingRow } from "@/lib/qb/types";

// Platform payment methods (payments.method enum in schema.sql).
const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "venmo_zelle", label: "Venmo / Zelle" },
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
];

interface ConnectionSummary {
  id: string;
  company_name: string | null;
  realm_id: string;
  sync_start_date: string | null;
  setup_completed_at: string | null;
  dry_run_mode: boolean;
}

type Step = 1 | 2 | 3;

interface MappingRow {
  platform_value: string;
  display_label: string;
  qb_entity_id: string;
  qb_entity_name: string;
}

export default function SetupWizardClient({
  connection,
  damageTypes,
}: {
  connection: ConnectionSummary;
  damageTypes: Array<{ name: string; display_label: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The "mappings" tab deep-link lets admins return here post-setup
  // to edit mappings without re-starting the start-date step.
  const initialStep: Step = connection.setup_completed_at
    ? 2
    : connection.sync_start_date
      ? 2
      : 1;
  const [step, setStep] = useState<Step>(
    searchParams.get("tab") === "mappings" ? 2 : initialStep,
  );

  // Step 1
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(
    connection.sync_start_date ?? today,
  );
  const [savingStartDate, setSavingStartDate] = useState(false);

  // Step 2 — QB reference data
  const [qbClasses, setQbClasses] = useState<QbClass[] | null>(null);
  const [qbAccounts, setQbAccounts] = useState<QbAccount[] | null>(null);
  const [loadingQbData, setLoadingQbData] = useState(true);
  const [qbError, setQbError] = useState<string | null>(null);

  // Step 2 — mapping rows (seeded from existing qb_mappings or defaults)
  const [classMappings, setClassMappings] = useState<MappingRow[]>(
    damageTypes.map((d) => ({
      platform_value: d.name,
      display_label: d.display_label,
      qb_entity_id: "",
      qb_entity_name: "",
    })),
  );
  const [methodMappings, setMethodMappings] = useState<MappingRow[]>(
    PAYMENT_METHODS.map((m) => ({
      platform_value: m.value,
      display_label: m.label,
      qb_entity_id: "",
      qb_entity_name: "",
    })),
  );
  const [savingMappings, setSavingMappings] = useState(false);

  // Step 3
  const [finishing, setFinishing] = useState(false);

  // Load QB classes / accounts + existing mappings when entering step 2.
  const loadQbData = useCallback(async () => {
    setLoadingQbData(true);
    setQbError(null);
    try {
      const [classesRes, accountsRes, mappingsRes] = await Promise.all([
        fetch("/api/qb/classes"),
        fetch("/api/qb/accounts"),
        fetch("/api/qb/mappings"),
      ]);
      if (!classesRes.ok) {
        const data = await classesRes.json().catch(() => ({ error: "" }));
        throw new Error(
          [data.error, data.code, data.detail]
            .filter(Boolean)
            .join(" | ") || "Failed to load QB Classes",
        );
      }
      if (!accountsRes.ok) {
        const data = await accountsRes.json().catch(() => ({ error: "" }));
        throw new Error(
          [data.error, data.code, data.detail]
            .filter(Boolean)
            .join(" | ") || "Failed to load QB Accounts",
        );
      }
      const classes = ((await classesRes.json()) as { classes: QbClass[] }).classes;
      const accounts = ((await accountsRes.json()) as { accounts: QbAccount[] }).accounts;
      const mappings =
        ((await mappingsRes.json()) as { mappings: QbMappingRow[] }).mappings ?? [];
      setQbClasses(classes);
      setQbAccounts(accounts);
      // Seed existing mappings.
      setClassMappings((prev) =>
        prev.map((row) => {
          const existing = mappings.find(
            (m) => m.type === "damage_type" && m.platform_value === row.platform_value,
          );
          return existing
            ? {
                ...row,
                qb_entity_id: existing.qb_entity_id,
                qb_entity_name: existing.qb_entity_name,
              }
            : row;
        }),
      );
      setMethodMappings((prev) =>
        prev.map((row) => {
          const existing = mappings.find(
            (m) => m.type === "payment_method" && m.platform_value === row.platform_value,
          );
          return existing
            ? {
                ...row,
                qb_entity_id: existing.qb_entity_id,
                qb_entity_name: existing.qb_entity_name,
              }
            : row;
        }),
      );
    } catch (err) {
      setQbError(err instanceof Error ? err.message : "QB API error");
    } finally {
      setLoadingQbData(false);
    }
  }, []);

  useEffect(() => {
    if (step === 2) loadQbData();
  }, [step, loadQbData]);

  async function handleSaveStartDate() {
    setSavingStartDate(true);
    const res = await fetch("/api/qb/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sync_start_date: startDate }),
    });
    if (res.ok) {
      setStep(2);
    } else {
      const data = await res.json().catch(() => ({ error: "" }));
      toast.error(data.error || "Failed to save start date");
    }
    setSavingStartDate(false);
  }

  function updateClassMapping(i: number, qb: QbClass | null) {
    setClassMappings((prev) => {
      const next = [...prev];
      next[i] = {
        ...next[i],
        qb_entity_id: qb?.Id ?? "",
        qb_entity_name: qb?.Name ?? "",
      };
      return next;
    });
  }

  function updateMethodMapping(i: number, acct: QbAccount | null) {
    setMethodMappings((prev) => {
      const next = [...prev];
      next[i] = {
        ...next[i],
        qb_entity_id: acct?.Id ?? "",
        qb_entity_name: acct?.Name ?? "",
      };
      return next;
    });
  }

  async function handleSaveMappings() {
    const filledClasses = classMappings.filter((m) => m.qb_entity_id);
    const filledMethods = methodMappings.filter((m) => m.qb_entity_id);
    if (filledClasses.length < 1) {
      toast.error("Map at least one damage type to a QB Class before continuing.");
      return;
    }
    if (filledMethods.length < 1) {
      toast.error("Map at least one payment method to a QB Deposit Account before continuing.");
      return;
    }

    setSavingMappings(true);
    const [r1, r2] = await Promise.all([
      fetch("/api/qb/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "damage_type",
          mappings: filledClasses.map((m) => ({
            platform_value: m.platform_value,
            qb_entity_id: m.qb_entity_id,
            qb_entity_name: m.qb_entity_name,
          })),
        }),
      }),
      fetch("/api/qb/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment_method",
          mappings: filledMethods.map((m) => ({
            platform_value: m.platform_value,
            qb_entity_id: m.qb_entity_id,
            qb_entity_name: m.qb_entity_name,
          })),
        }),
      }),
    ]);
    setSavingMappings(false);
    if (!r1.ok || !r2.ok) {
      toast.error("Failed to save mappings");
      return;
    }
    toast.success("Mappings saved");
    if (connection.setup_completed_at) {
      router.push("/settings/accounting");
    } else {
      setStep(3);
    }
  }

  async function handleFinishSetup() {
    setFinishing(true);
    const res = await fetch("/api/qb/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complete_setup: true }),
    });
    setFinishing(false);
    if (res.ok) {
      toast.success("Setup complete. Dry run is now tracking.");
      router.push("/accounting?tab=quickbooks");
    } else {
      const data = await res.json().catch(() => ({ error: "" }));
      toast.error(data.error || "Failed to complete setup");
    }
  }

  const classMappedCount = classMappings.filter((m) => m.qb_entity_id).length;
  const methodMappedCount = methodMappings.filter((m) => m.qb_entity_id).length;
  const mappingsSavable = classMappedCount > 0 && methodMappedCount > 0;

  return (
    <div className="max-w-3xl">
      <Link
        href="/settings/accounting"
        className="text-sm text-primary hover:underline inline-flex items-center gap-1 mb-3"
      >
        <ArrowLeft size={14} /> Back to Accounting Settings
      </Link>
      <h1 className="text-3xl font-extrabold text-foreground mb-1">
        QuickBooks Setup
      </h1>
      <p className="text-muted-foreground mb-6">
        Three steps. Takes about 5 minutes.
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step === n
                  ? "bg-[var(--brand-primary,#0F6E56)] text-white"
                  : step > n
                    ? "bg-green-500/20 text-green-700"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {step > n ? <CheckCircle2 size={14} /> : n}
            </div>
            <span className={step === n ? "font-medium text-foreground" : "text-muted-foreground"}>
              {n === 1 ? "Start date" : n === 2 ? "Mappings" : "Review"}
            </span>
            {n < 3 && <span className="mx-2 text-muted-foreground/40">—</span>}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Sync start date</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Nothing before this date will sync to QuickBooks. Set this to the date your CPA finishes cleanup in QuickBooks.
            </p>
          </div>
          <input
            type="date"
            value={startDate}
            min={new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            max={new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
            <AlertTriangle className="text-amber-500 shrink-0" size={18} />
            <p className="text-xs text-amber-700">
              Make sure your CPA has completed the books cleanup before setting this date. Forward-only sync means historical data won&apos;t backfill into QB. This cannot be changed without reconnecting.
            </p>
          </div>
          <div className="flex items-center justify-end pt-2">
            <button
              onClick={handleSaveStartDate}
              disabled={savingStartDate || !startDate}
              className="px-5 py-2.5 rounded-lg bg-[var(--brand-primary,#0F6E56)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              {savingStartDate && <Loader2 size={14} className="animate-spin" />}
              Next <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="space-y-4">
          {loadingQbData ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
              <Loader2 className="animate-spin mx-auto mb-2" size={22} />
              Loading QuickBooks Classes and Accounts…
            </div>
          ) : qbError ? (
            <div className="bg-card rounded-xl border border-red-500/30 p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0" size={20} />
                <div>
                  <p className="font-medium text-red-700">Failed to load QuickBooks data</p>
                  <p className="text-sm text-red-600/80 mt-1">{qbError}</p>
                  <button
                    onClick={loadQbData}
                    className="mt-3 text-sm text-red-600 underline hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Damage types → QB Classes */}
              <div className="bg-card rounded-xl border border-border p-6">
                <h3 className="font-semibold text-foreground">Damage types → QB Classes</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Maps each platform damage type to a QuickBooks Class for profitability tracking.
                </p>
                {(qbClasses?.length ?? 0) === 0 ? (
                  <div className="mt-4 p-4 bg-amber-500/10 rounded-lg border border-amber-500/30 text-sm">
                    <p className="font-medium text-amber-700">Classes not enabled in QuickBooks</p>
                    <p className="text-amber-600/90 mt-1">
                      Enable them first:{" "}
                      <a
                        href="https://quickbooks.intuit.com/learn-support/en-us/help-article/account-management/turn-classes/L0TbJ0Q74_US_en_US"
                        target="_blank"
                        rel="noreferrer"
                        className="underline inline-flex items-center gap-1"
                      >
                        Settings → Advanced → Categories → Track classes
                        <ExternalLink size={12} />
                      </a>
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {classMappings.map((row, i) => (
                      <div
                        key={row.platform_value}
                        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
                      >
                        <div className="text-sm font-medium text-foreground">
                          {row.display_label}
                        </div>
                        <ArrowRight size={14} className="text-muted-foreground" />
                        <select
                          value={row.qb_entity_id}
                          onChange={(e) =>
                            updateClassMapping(
                              i,
                              qbClasses?.find((c) => c.Id === e.target.value) ?? null,
                            )
                          }
                          className="border border-border rounded-lg px-2.5 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="">— unmapped —</option>
                          {qbClasses?.map((c) => (
                            <option key={c.Id} value={c.Id}>
                              {c.FullyQualifiedName ?? c.Name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Payment methods → Deposit Accounts */}
              <div className="bg-card rounded-xl border border-border p-6">
                <h3 className="font-semibold text-foreground">Payment methods → Deposit Accounts</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Which QB bank or deposit account each platform payment method lands in.
                </p>
                <div className="mt-4 space-y-2">
                  {methodMappings.map((row, i) => (
                    <div
                      key={row.platform_value}
                      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
                    >
                      <div className="text-sm font-medium text-foreground">
                        {row.display_label}
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground" />
                      <select
                        value={row.qb_entity_id}
                        onChange={(e) =>
                          updateMethodMapping(
                            i,
                            qbAccounts?.find((a) => a.Id === e.target.value) ?? null,
                          )
                        }
                        className="border border-border rounded-lg px-2.5 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">— unmapped —</option>
                        {qbAccounts?.map((a) => (
                          <option key={a.Id} value={a.Id}>
                            {a.Name} ({a.AccountType})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Expense Categories (reserved) */}
              <div className="bg-card rounded-xl border border-border p-6 opacity-60">
                <h3 className="font-semibold text-muted-foreground">Expense Categories</h3>
                <p className="text-sm text-muted-foreground/80 mt-1">
                  Not used in current build — expenses are not synced to QuickBooks.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  disabled={!!connection.setup_completed_at}
                  className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  onClick={handleSaveMappings}
                  disabled={savingMappings || !mappingsSavable}
                  className="px-5 py-2.5 rounded-lg bg-[var(--brand-primary,#0F6E56)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
                >
                  {savingMappings && <Loader2 size={14} className="animate-spin" />}
                  {connection.setup_completed_at ? "Save mappings" : "Save & continue"}
                  {!connection.setup_completed_at && <ArrowRight size={14} />}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Review</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Everything&apos;s set up. Dry run starts as soon as you finish.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Sync start date</dt>
            <dd className="text-foreground">{startDate}</dd>
            <dt className="text-muted-foreground">Class mappings</dt>
            <dd className="text-foreground">{classMappedCount} of {classMappings.length}</dd>
            <dt className="text-muted-foreground">Deposit-account mappings</dt>
            <dd className="text-foreground">{methodMappedCount} of {methodMappings.length}</dd>
          </dl>
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
            <AlertTriangle className="text-amber-500 shrink-0" size={18} />
            <p className="text-xs text-amber-700">
              Dry run mode is ON by default. For the next 7+ days, Nookleus will track what WOULD sync to QuickBooks without actually making changes. Review the &quot;What would have synced&quot; log on the Accounting page&apos;s QuickBooks tab. When you&apos;re confident the mappings are correct, flip the switch to live mode.
            </p>
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setStep(2)}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              onClick={handleFinishSetup}
              disabled={finishing}
              className="px-5 py-2.5 rounded-lg bg-[var(--brand-primary,#0F6E56)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              {finishing && <Loader2 size={14} className="animate-spin" />}
              Finish setup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
