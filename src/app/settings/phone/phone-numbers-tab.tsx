"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone as PhoneIcon, Plus, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatPhoneNumber } from "@/lib/phone";

// PRD #304 — Nookleus Phone. Slice 3 (#307) — Settings → Phone tab.
//
// Lists every phone_numbers row in the active org and lets an admin
// provision a new Shared number from Twilio or release an existing one.
// Non-admins see the read-only list (the AC allows this — they get the
// surface; the management affordances are hidden).
//
// Slice 3 lands the Shared path only. Personal numbers (slice 13) will
// show up in the same list under an "Owner: X" column; the table is
// already prepared for that — `kind` and `user_id` are surfaced on each
// row so slice 13 is a UI-extension delivery rather than a rewrite.

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  twilio_sid: string;
  e164: string;
  label: string | null;
  kind: "shared" | "personal";
  user_id: string | null;
  inbound_rule: unknown | null;
  monthly_cost_cents: number | null;
  is_active: boolean;
  released_at: string | null;
  created_at: string;
}

interface AvailableLocalNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
}

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function PhoneNumbersTab() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [rows, setRows] = useState<PhoneNumberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-Shared-Number flow state.
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [available, setAvailable] = useState<AvailableLocalNumber[]>([]);
  const [pickedNumber, setPickedNumber] = useState<AvailableLocalNumber | null>(
    null,
  );
  const [label, setLabel] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  // Release-confirm flow state — the row the admin clicked Release on.
  const [releasing, setReleasing] = useState<PhoneNumberRow | null>(null);
  const [releaseInFlight, setReleaseInFlight] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/phone/numbers");
      if (!res.ok) {
        setError("Failed to load phone numbers");
        setRows([]);
        return;
      }
      const data = (await res.json()) as PhoneNumberRow[];
      setRows(data);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const liveRows = useMemo(
    () => rows.filter((r) => r.released_at === null),
    [rows],
  );

  async function handleSearch() {
    setSearching(true);
    setAvailable([]);
    try {
      const res = await fetch(
        `/api/phone/numbers/available?areaCode=${encodeURIComponent(areaCode)}`,
      );
      if (!res.ok) {
        setError("Failed to search for numbers");
        return;
      }
      setAvailable((await res.json()) as AvailableLocalNumber[]);
    } finally {
      setSearching(false);
    }
  }

  async function handleProvision() {
    if (!pickedNumber) return;
    setProvisioning(true);
    try {
      const res = await fetch("/api/phone/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: pickedNumber.phoneNumber,
          label: label || pickedNumber.friendlyName,
        }),
      });
      if (!res.ok) {
        setError("Failed to provision number");
        return;
      }
      // Reload so the new row appears with the server's canonical fields.
      await load();
      // Reset the dialog state.
      setShowAddDialog(false);
      setAreaCode("");
      setAvailable([]);
      setPickedNumber(null);
      setLabel("");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleReleaseConfirm() {
    if (!releasing) return;
    setReleaseInFlight(true);
    try {
      const res = await fetch(`/api/phone/numbers/${releasing.id}/release`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to release number");
        return;
      }
      await load();
      setReleasing(null);
    } finally {
      setReleaseInFlight(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneIcon size={20} className="text-[var(--brand-primary)]" />
          <h2 className="text-xl font-semibold text-foreground">
            Phone numbers
          </h2>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--brand-primary)] text-white text-sm font-medium hover:opacity-90"
          >
            <Plus size={16} />
            Add Shared Number
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-sm px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : liveRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PhoneIcon
            size={28}
            className="mx-auto text-muted-foreground mb-3"
          />
          <p className="text-sm text-muted-foreground">
            No phone numbers yet — click <strong>Add Shared Number</strong> to
            provision your first one.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Inbound rule</th>
                <th className="px-3 py-2 font-medium">Monthly cost</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {liveRows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-foreground text-xs">
                      {r.kind === "shared" ? "Shared" : "Personal"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPhoneNumber(r.e164)}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {r.label ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.kind === "shared" ? "—" : r.user_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    ring-all default — configurable in slice 8
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {formatCents(r.monthly_cost_cents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setReleasing(r)}
                        className="inline-flex items-center gap-1 text-destructive text-xs font-medium hover:underline"
                      >
                        <Trash2 size={12} />
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Shared Number dialog — area code → pick → label → provision. */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Add Shared Number
            </h3>

            <div className="space-y-2">
              <label
                htmlFor="add-area-code"
                className="text-sm font-medium text-foreground"
              >
                Area code
              </label>
              <div className="flex gap-2">
                <input
                  id="add-area-code"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="512"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || !areaCode}
                  className="rounded-md bg-secondary text-secondary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {available.length > 0 && (
              <div className="rounded-md border border-border divide-y divide-border max-h-40 overflow-auto">
                {available.map((n) => (
                  <button
                    key={n.phoneNumber}
                    type="button"
                    onClick={() => setPickedNumber(n)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${
                      pickedNumber?.phoneNumber === n.phoneNumber
                        ? "bg-accent"
                        : ""
                    }`}
                  >
                    <div className="font-mono">{n.friendlyName}</div>
                    <div className="text-xs text-muted-foreground">
                      {n.locality ?? "—"}, {n.region ?? "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {pickedNumber && (
              <div className="space-y-2">
                <label
                  htmlFor="add-label"
                  className="text-sm font-medium text-foreground"
                >
                  Label
                </label>
                <input
                  id="add-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Marketing"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddDialog(false);
                  setAreaCode("");
                  setAvailable([]);
                  setPickedNumber(null);
                  setLabel("");
                }}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProvision}
                disabled={!pickedNumber || provisioning}
                className="rounded-md bg-[var(--brand-primary)] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {provisioning ? "Provisioning…" : "Provision"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Release confirmation. */}
      {releasing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Release {formatPhoneNumber(releasing.e164)}?
            </h3>
            <p className="text-sm text-muted-foreground">
              This returns the number to Twilio. Inbound and outbound on this
              number will stop immediately. The row is kept for audit.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReleasing(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReleaseConfirm}
                disabled={releaseInFlight}
                className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {releaseInFlight ? "Releasing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
