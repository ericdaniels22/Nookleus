"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { escapeOrFilterValue } from "@/lib/postgrest";
import { isValidClaimsEmail, shouldOfferCreate } from "@/lib/insurance-picker";
import { Input } from "@/components/ui/input";
import type { Contact } from "@/lib/types";

interface InsuranceCompanyPickerProps {
  /** The insurance contact currently linked to the job, or null if none. */
  value: Contact | null;
  /** Fires when the user picks a company or clears the selection. */
  onChange: (contact: Contact | null) => void;
}

/**
 * Search-as-you-type picker for an insurance company — a contact with
 * role = 'insurance'. Used inside the job-detail Edit Insurance dialog
 * (PRD #47). When the typed name matches no existing insurance company,
 * the picker offers a deliberate "+ New insurance company" action that
 * inline-expands — never a modal — a two-field create form (PRD #47,
 * slice 2 / issue #194). Cross-organization isolation is delegated to
 * row-level security on `contacts`, exactly as the adjuster search is —
 * the search query never names an organization.
 */
export default function InsuranceCompanyPicker({
  value,
  onChange,
}: InsuranceCompanyPickerProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  // The inline-create form: `creating` expands it in place of the
  // search box — deliberately not a modal, since the picker can itself
  // already live inside the job-detail Edit Insurance dialog.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // Every setState runs inside the debounce callback, never
    // synchronously in the effect body — the react-hooks/set-state-in-effect
    // avoidance also used in job-cover-picker.tsx.
    const timer = setTimeout(async () => {
      const query = search.trim();
      if (!query) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const supabase = createClient();
      const term = escapeOrFilterValue(`%${query}%`);
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .eq("role", "insurance")
        .or(`full_name.ilike.${term},company.ilike.${term}`)
        .limit(10);
      setResults((data as Contact[] | null) ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Inserts the typed company as a contact (role = 'insurance') in the
  // active organization and auto-selects it. The new company is an
  // ordinary contact — it shows up in the Contacts tab afterwards.
  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setFormError("Enter a company name.");
      return;
    }
    if (!isValidClaimsEmail(newEmail)) {
      setFormError("Enter a valid claims email, or leave it blank.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const supabase = createClient();
    const organizationId = await getActiveOrganizationId(supabase);
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        full_name: name,
        email: newEmail.trim() || null,
        role: "insurance",
        organization_id: organizationId,
      })
      .select()
      .single();
    setSubmitting(false);
    if (error || !data) {
      setFormError("Could not create the insurance company. Please try again.");
      return;
    }
    setCreating(false);
    onChange(data as Contact);
  }

  // Selected state: the job already has a linked insurance company.
  // Clearing it returns to the search state so a different company can
  // be picked, which is how "change the company" is reached.
  if (value) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background/50 p-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {value.full_name}
          </p>
          {value.email && (
            <p className="text-xs text-muted-foreground">{value.email}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Clear insurance company"
          onClick={() => onChange(null)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
        <div>
          <label
            htmlFor="new-insurance-name"
            className="block text-sm font-medium text-muted-foreground mb-1"
          >
            Company name
          </label>
          <Input
            id="new-insurance-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="new-insurance-email"
            className="block text-sm font-medium text-muted-foreground mb-1"
          >
            Claims email (optional)
          </label>
          <Input
            id="new-insurance-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>
        {formError && (
          <p className="text-sm text-destructive">{formError}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating…" : "Create company"}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search insurance companies..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!searching && search.trim() && results.length === 0 && (
        <p className="text-sm text-muted-foreground/60 text-center py-4">
          No matching insurance companies found
        </p>
      )}
      {results.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c)}
              className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
            >
              <p className="text-sm font-medium text-foreground">
                {c.full_name}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.email ?? "No claims email on file"}
              </p>
            </button>
          ))}
        </div>
      )}
      {!searching &&
        shouldOfferCreate(
          search,
          results.map((c) => c.full_name),
        ) && (
          <button
            type="button"
            onClick={() => {
              setNewName(search.trim());
              setNewEmail("");
              setFormError(null);
              setCreating(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <Plus size={14} />
            New insurance company
          </button>
        )}
    </div>
  );
}
