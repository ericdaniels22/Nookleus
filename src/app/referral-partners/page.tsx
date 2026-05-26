"use client";

// Referral Partners list page (PRD #249, issue #250).
// Renders every non-deleted partner in the Active Organization with the
// Lifecycle-status color chip, company name, and industry. The "+ Add
// Target" button opens the New Target dialog. Filtering, sorting, and
// per-row denormalized columns (last_called_at etc.) arrive in later
// slices (#251, #254).

import { useCallback, useEffect, useState } from "react";
import { Handshake, Plus } from "lucide-react";
import NewTargetDialog from "@/components/referral-partners/new-target-dialog";

interface ReferralPartner {
  id: string;
  company_name: string;
  status: "grey" | "yellow" | "green" | "red";
  industry: string | null;
}

const STATUS_CHIP_CLASS: Record<ReferralPartner["status"], string> = {
  grey:   "bg-gray-200 text-gray-700",
  yellow: "bg-yellow-200 text-yellow-900",
  green:  "bg-green-200 text-green-900",
  red:    "bg-red-200 text-red-900",
};

const STATUS_LABEL: Record<ReferralPartner["status"], string> = {
  grey:   "Uncontacted",
  yellow: "In progress",
  green:  "Active",
  red:    "Declined",
};

export default function ReferralPartnersPage() {
  const [partners, setPartners] = useState<ReferralPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/referral-partners");
    if (!res.ok) {
      setError(res.status === 403 ? "You don't have access to Referral Partners." : "Could not load partners.");
      setLoading(false);
      return;
    }
    const body = await res.json();
    setPartners(body.referral_partners ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Handshake size={24} className="text-primary" />
          <h1 className="text-2xl font-heading font-semibold">Referral Partners</h1>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="btn btn-primary inline-flex items-center gap-2"
        >
          <Plus size={16} />
          Add Target
        </button>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : partners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partners yet. Click <strong>Add Target</strong> to start your cold-call list.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border border-border bg-card">
          {partners.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP_CLASS[p.status]}`}
              >
                {STATUS_LABEL[p.status]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.company_name}</p>
                {p.industry && (
                  <p className="text-xs text-muted-foreground truncate">{p.industry}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewTargetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => void load()}
      />
    </div>
  );
}
