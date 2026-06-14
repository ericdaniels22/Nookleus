"use client";

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";

interface EmailRecipient {
  email: string;
  name: string;
}

export interface EmailAddressInputHandle {
  flush: () => void;
}

interface EmailAddressInputProps {
  label: string;
  recipients: EmailRecipient[];
  onChange: (recipients: EmailRecipient[]) => void;
  placeholder?: string;
  /**
   * "boxed" (default) draws the original bordered field with a stacked label.
   * "inline" drops the border and stacked label so the field flows inside a
   * hairline-separated compose row (PRD #634, issue #640); the parent row
   * supplies the visible label and the input is aria-labelled instead.
   */
  variant?: "boxed" | "inline";
}

const EmailAddressInput = forwardRef<EmailAddressInputHandle, EmailAddressInputProps>(
  function EmailAddressInput(
  {
    label,
    recipients,
    onChange,
    placeholder = "Type name or email...",
    variant = "boxed",
  },
  ref
) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<EmailRecipient[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Expose flush method to commit pending input synchronously
  useImperativeHandle(ref, () => ({
    flush: () => {
      if (input.trim() && input.includes("@")) {
        flushSync(() => {
          onChange([...recipients, { email: input.trim(), name: "" }]);
          setInput("");
        });
      }
    },
  }));

  // Fetch suggestions
  useEffect(() => {
    if (input.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/email/contacts?q=${encodeURIComponent(input)}`
        );
        const data = await res.json();
        // Filter out already-added recipients
        const existing = new Set(recipients.map((r) => r.email.toLowerCase()));
        setSuggestions(
          data.filter(
            (s: EmailRecipient) => !existing.has(s.email.toLowerCase())
          )
        );
        setSelectedIndex(0);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [input, recipients]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function addRecipient(recipient: EmailRecipient) {
    onChange([...recipients, recipient]);
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeRecipient(index: number) {
    onChange(recipients.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && suggestions[selectedIndex]) {
        addRecipient(suggestions[selectedIndex]);
      } else if (input.includes("@")) {
        addRecipient({ email: input.trim(), name: "" });
      }
    } else if (e.key === "," || e.key === "Tab") {
      if (input.includes("@")) {
        e.preventDefault();
        addRecipient({ email: input.trim().replace(/,$/, ""), name: "" });
      }
    } else if (
      e.key === "Backspace" &&
      input === "" &&
      recipients.length > 0
    ) {
      removeRecipient(recipients.length - 1);
    }
  }

  const isInline = variant === "inline";

  return (
    <div ref={containerRef} className={isInline ? "relative flex-1 min-w-0" : "relative"}>
      {!isInline && (
        <label className="block text-sm font-medium text-[#333] mb-1">
          {label}
        </label>
      )}
      <div
        className={
          isInline
            ? "flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text"
            : "flex flex-wrap items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 min-h-[38px] cursor-text focus-within:ring-2 focus-within:ring-[#2B5EA7]/30 focus-within:border-[#2B5EA7]"
        }
        onClick={() => inputRef.current?.focus()}
      >
        {recipients.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-[#2B5EA7]/10 text-[#2B5EA7] text-xs font-medium px-2 py-1 rounded-full"
          >
            {r.name ? `${r.name} <${r.email}>` : r.email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeRecipient(i);
              }}
              className="hover:text-red-600"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          aria-label={isInline ? label : undefined}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => input.length >= 1 && setShowSuggestions(true)}
          placeholder={recipients.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] text-sm text-[#333] outline-none bg-transparent py-0.5 placeholder:text-[#999]"
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onClick={() => addRecipient(s)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                i === selectedIndex
                  ? "bg-[#2B5EA7]/5 text-[#2B5EA7]"
                  : "hover:bg-gray-50"
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-[#2B5EA7] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                {(s.name || s.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                {s.name && (
                  <div className="font-medium text-[#333] truncate">
                    {s.name}
                  </div>
                )}
                <div className="text-[#999] text-xs truncate">{s.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default EmailAddressInput;
