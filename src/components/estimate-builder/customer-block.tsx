"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, User } from "lucide-react";
import type { BuilderMode, Contact, Job } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// CustomerBlock — read-only display of customer info pulled from the job.
// No "View customer" link is rendered because /contacts/[id] does not exist yet.
// TODO(post-67a): add View customer link when /contacts/[id] detail page exists
// ─────────────────────────────────────────────────────────────────────────────

interface CustomerBlockProps {
  job: Job & { contact: Contact | null };
  mode?: BuilderMode;
}

export function CustomerBlock({ job, mode = "estimate" }: CustomerBlockProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  if (mode === "template") return null;
  const { contact } = job;
  const customerName = contact
    ? `${contact.first_name} ${contact.last_name}`.trim()
    : "—";

  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <User size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Customer
          </span>
          {isCollapsed && (
            <span className="text-sm font-medium text-foreground truncate">
              · {customerName}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
          aria-label={isCollapsed ? "Expand customer block" : "Collapse customer block"}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="text-sm space-y-0.5 mt-2">
          <div className="font-medium text-foreground">{customerName}</div>
          {job.property_address && (
            <div className="text-muted-foreground">{job.property_address}</div>
          )}
          {contact?.email && (
            <div className="text-muted-foreground">{contact.email}</div>
          )}
          {contact?.phone && (
            <div className="text-muted-foreground">{contact.phone}</div>
          )}
        </div>
      )}
    </div>
  );
}
