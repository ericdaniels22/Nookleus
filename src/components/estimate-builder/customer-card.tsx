"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Mail, MapPin, Phone } from "lucide-react";
import type { BuilderMode, Contact, Job } from "@/lib/types";
import { formatPhoneNumber } from "@/lib/phone";

// ─────────────────────────────────────────────────────────────────────────────
// CustomerCard (#570) — read-only card showing who the Estimate is for, pulled
// from the Job's contact. The Estimate stores no customer of its own, so
// nothing here is editable; customer data is managed on the Job.
// No "View customer" link is rendered because /contacts/[id] does not exist yet.
// TODO(post-67a): add View customer link when /contacts/[id] detail page exists
// ─────────────────────────────────────────────────────────────────────────────

interface CustomerCardProps {
  /** `Omit` keeps the joined `contact` genuinely nullable — a plain
   *  intersection with `Job` would swallow the `null` arm, and the whole
   *  point of this card is to render the contactless case (#570). */
  job: Omit<Job, "contact"> & { contact: Contact | null };
  mode?: BuilderMode;
}

/** "Dana Whitfield" → "DW"; single names yield a single letter. */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function DetailLine({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export function CustomerCard({ job, mode = "estimate" }: CustomerCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  // An Estimate template belongs to no Job, so there is no customer to show.
  if (mode === "template") return null;
  const { contact } = job;
  const customerName = contact ? contact.full_name.trim() : "";

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {contact ? initials(customerName) : "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Customer
          </div>
          <div className="text-sm font-medium text-foreground truncate">
            {contact ? customerName : "No customer yet"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
          aria-label={
            isCollapsed ? "Expand customer card" : "Collapse customer card"
          }
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Customer data is owned by the Job — when there is no contact we show
          a soft pointer there, never an add-customer form (#570). */}
      {isCollapsed ? null : contact === null ? (
        <p className="mt-2 pl-11 text-sm text-muted-foreground">
          Manage the customer on the Job.
        </p>
      ) : (
        <div className="mt-2 space-y-1 pl-11">
          {job.property_address && (
            <DetailLine icon={<MapPin size={13} />}>
              {job.property_address}
            </DetailLine>
          )}
          {contact.email && (
            <DetailLine icon={<Mail size={13} />}>{contact.email}</DetailLine>
          )}
          {contact.phone && (
            <DetailLine icon={<Phone size={13} />}>
              {formatPhoneNumber(contact.phone)}
            </DetailLine>
          )}
        </div>
      )}
    </div>
  );
}
