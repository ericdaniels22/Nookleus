"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import TiptapEditor from "@/components/tiptap-editor";
import type { BuilderMode } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function isEmptyHtml(s: string | null): boolean {
  if (s === null || s === "") return true;
  const stripped = s.replace(/<[^>]*>/g, "").trim();
  return stripped === "";
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

const placeholders: Record<string, Record<string, string>> = {
  estimate: {
    opening: "Estimate opening — describe scope, conditions, expectations.",
    closing: "Estimate closing — payment terms, validity, signature line.",
  },
  invoice: {
    opening: "Invoice opening — thank-you, summary, project context.",
    closing: "Invoice closing — payment terms, late-fee policy, contact info.",
  },
  template: {
    opening: "Template opening — pre-fills new estimates.",
    closing: "Template closing — pre-fills new estimates.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface StatementEditorProps {
  label: "Opening statement" | "Closing statement";
  value: string | null;
  onChange: (next: string | null) => void;
  defaultText: string; // resolved from company_settings by parent
  readOnly?: boolean;
  mode?: BuilderMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// StatementEditor
// ─────────────────────────────────────────────────────────────────────────────

export function StatementEditor({
  label,
  value,
  onChange,
  defaultText,
  readOnly = false,
  mode = "estimate",
}: StatementEditorProps) {
  // resetCounter forces TiptapEditor to unmount/remount when the user clicks
  // "Reset to default", so the editor re-initializes with the new content prop.
  const [resetCounter, setResetCounter] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const showResetButton =
    !readOnly && defaultText !== "" && value !== defaultText;

  function handleChange(html: string) {
    onChange(isEmptyHtml(html) ? null : html);
  }

  function handleReset() {
    onChange(defaultText);
    // Bump the key so TiptapEditor re-mounts with the default content.
    setResetCounter((c) => c + 1);
  }

  const which = label === "Opening statement" ? "opening" : "closing";
  const placeholder = placeholders[mode][which];

  // When value is empty, pass empty string as content so TiptapEditor shows
  // the placeholder; otherwise pass the actual HTML.
  const editorContent = isEmptyHtml(value) ? "" : (value as string);

  // ── readOnly path ──────────────────────────────────────────────────────────

  if (readOnly) {
    const displayHtml = isEmptyHtml(value)
      ? isEmptyHtml(defaultText)
        ? ""
        : defaultText
      : (value as string);

    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </Label>
        {displayHtml ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No {label.toLowerCase()} set.
          </p>
        )}
      </div>
    );
  }

  // ── editable path ──────────────────────────────────────────────────────────

  // Collapsed preview: strip HTML tags from the value (or fall back to default), truncate
  const collapsedPreview = (() => {
    const source = !isEmptyHtml(value) ? (value as string) : defaultText;
    const stripped = stripHtmlTags(source).trim();
    if (!stripped) return null;
    return stripped.length > 80 ? stripped.slice(0, 80) + "…" : stripped;
  })();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      {/* Header row: label + reset button + collapse toggle */}
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground font-medium shrink-0">
          {label}
        </Label>
        <div className="flex items-center gap-1 shrink-0">
          {showResetButton && !isCollapsed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={handleReset}
            >
              <RotateCcw size={12} />
              Reset to default
            </Button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={isCollapsed ? `Expand ${label.toLowerCase()}` : `Collapse ${label.toLowerCase()}`}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* Collapsed preview OR full editor */}
      {isCollapsed ? (
        <div className="text-sm text-muted-foreground italic">
          {collapsedPreview || "(empty)"}
        </div>
      ) : (
        <TiptapEditor
          key={resetCounter}
          content={editorContent}
          onChange={handleChange}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
