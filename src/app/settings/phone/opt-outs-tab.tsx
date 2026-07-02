"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { formatPhoneNumber } from "@/lib/phone";

// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Settings → Phone → Opt-outs tab. Lists every opt-out row in the active
// org and offers a Re-opt-in action (admin-only). The re-opt-in flow
// requires a free-text note — the audit trail of WHY fresh consent was
// granted (per the PRD AC).
//
// Non-admin callers see the list as a read-only audit surface (which AC
// #45 explicitly allows — "An admin can ..."; non-admin gets the list,
// admins get the action).

interface OptOutRow {
  id: string;
  organization_id: string;
  outside_e164: string;
  opted_out_at: string;
  re_opted_in_at: string | null;
  re_opted_in_note: string | null;
  re_opted_in_by_user_id: string | null;
}

export function OptOutsTab() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [rows, setRows] = useState<OptOutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reOptInFor, setReOptInFor] = useState<OptOutRow | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/phone/opt-outs");
      if (!res.ok) {
        setError("Failed to load opt-outs");
        return;
      }
      setRows((await res.json()) as OptOutRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onConfirm = useCallback(async () => {
    if (!reOptInFor) return;
    if (note.trim().length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/phone/opt-outs/${reOptInFor.id}/re-opt-in`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        },
      );
      if (!res.ok) {
        setError("Failed to re-opt-in");
        return;
      }
      setReOptInFor(null);
      setNote("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }, [reOptInFor, note, load]);

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No opt-outs in this organization.
      </p>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((r) => {
          const reOpted = !!r.re_opted_in_at;
          return (
            <li key={r.id} className="p-3 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">
                  {formatPhoneNumber(r.outside_e164)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Opted out {new Date(r.opted_out_at).toLocaleDateString()}
                </div>
                {reOpted ? (
                  <>
                    <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Re-opted-in
                    </span>
                    {r.re_opted_in_note ? (
                      <div className="text-xs text-muted-foreground italic">
                        “{r.re_opted_in_note}”
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="inline-block rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    Opted out
                  </span>
                )}
              </div>
              {isAdmin && !reOpted ? (
                <button
                  type="button"
                  onClick={() => {
                    setReOptInFor(r);
                    setNote("");
                  }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Re-opt-in
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {reOptInFor ? (
        <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
          <h3 className="text-sm font-semibold">
            Re-opt-in {formatPhoneNumber(reOptInFor.outside_e164)}
          </h3>
          <p className="text-xs text-muted-foreground">
            Confirm the customer has given fresh consent. The note is
            recorded for the audit trail.
          </p>
          <label className="block text-xs text-muted-foreground">
            Note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. customer phoned and asked to be re-added on 2026-05-27"
              className="mt-1 block w-full resize-none rounded-md border border-border bg-background p-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setReOptInFor(null);
                setNote("");
              }}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={submitting || note.trim().length === 0}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
