"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { selectableContacts } from "@/lib/email/contact-picker";

interface Recipient {
  email: string;
  name: string;
}

interface ContactPickerProps {
  /** Recipients already on the field — these are filtered out of the list. */
  addedRecipients: Recipient[];
  /** Fires with the chosen contact. */
  onSelect: (recipient: Recipient) => void;
  /** Optional dismiss affordance (e.g. the picker is shown in a popover). */
  onClose?: () => void;
}

/**
 * A search-driven picker for the To row (PRD #634, issue #640). It reuses the
 * existing contacts suggestion source (`/api/email/contacts`) — the same one
 * the type-ahead reads — so "browse and pick" and "type a recipient" stay in
 * sync. Already-added recipients are excluded by the pure
 * {@link selectableContacts} decision, so the picker never offers a duplicate.
 */
export default function ContactPicker({
  addedRecipients,
  onSelect,
  onClose,
}: ContactPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  useEffect(() => {
    // setState only inside the debounce callback, never synchronously in the
    // effect body — the react-hooks/set-state-in-effect avoidance used across
    // the pickers (insurance-company-picker.tsx, job-cover-picker.tsx).
    //
    // `ignore` guards against out-of-order responses (issue #659): when the
    // query changes the cleanup flips it, so a slower earlier fetch can't land
    // its (now stale) results over a newer query's.
    let ignore = false;
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/email/contacts?q=${encodeURIComponent(q)}`,
        );
        const data = (await res.json()) as Recipient[];
        if (ignore) return;
        setResults(Array.isArray(data) ? data : []);
      } catch {
        if (ignore) return;
        setResults([]);
      }
    }, 200);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [query]);

  const pickable = selectableContacts(results, addedRecipients);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // Enter inside the picker must never reach the compose <form> and fire an
    // early send (issue #659). Swallow it here; if a candidate is showing,
    // pressing Enter picks the first one — otherwise it just does nothing.
    e.preventDefault();
    if (pickable.length > 0) {
      onSelect(pickable[0]);
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <Search size={14} className="text-[#999] shrink-0" />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={pickable.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            pickable.length > 0 ? optionId(0) : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search contacts…"
          className="flex-1 min-w-0 text-sm outline-none bg-transparent"
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contact picker"
            className="text-[#999] hover:text-[#333]"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div
        id={listboxId}
        role="listbox"
        className="max-h-60 overflow-y-auto py-1"
      >
        {query.trim() && pickable.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-[#999]">
            No matching contacts
          </p>
        ) : (
          pickable.map((c, i) => (
            <button
              key={c.email}
              id={optionId(i)}
              role="option"
              aria-selected={i === 0}
              type="button"
              onClick={() => onSelect(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-[var(--brand-primary,#0F6E56)] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                {(c.name || c.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                {c.name && (
                  <div className="font-medium text-[#333] truncate">
                    {c.name}
                  </div>
                )}
                <div className="text-[#999] text-xs truncate">{c.email}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
