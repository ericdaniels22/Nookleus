"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { createClient } from "@/lib/supabase";
import { escapeOrFilterValue } from "@/lib/postgrest";
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
 * (PRD #47, slice 1). Select-existing-only: there is no "+ New" create
 * affordance yet (that is slice 2). Cross-organization isolation is
 * delegated to row-level security on `contacts`, exactly as the adjuster
 * search is — the query never names an organization.
 */
export default function InsuranceCompanyPicker({
  value,
  onChange,
}: InsuranceCompanyPickerProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

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
    </div>
  );
}
