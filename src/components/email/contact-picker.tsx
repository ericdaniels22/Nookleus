"use client";

import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    // setState only inside the debounce callback, never synchronously in the
    // effect body — the react-hooks/set-state-in-effect avoidance used across
    // the pickers (insurance-company-picker.tsx, job-cover-picker.tsx).
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
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const pickable = selectableContacts(results, addedRecipients);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <Search size={14} className="text-[#999] shrink-0" />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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

      <div className="max-h-60 overflow-y-auto py-1">
        {query.trim() && pickable.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-[#999]">
            No matching contacts
          </p>
        ) : (
          pickable.map((c) => (
            <button
              key={c.email}
              type="button"
              onClick={() => onSelect(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-[#2B5EA7] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
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
