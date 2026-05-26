"use client";

// Editable Call Worksheet (PRD #249, issues #252 base + #253 editable).
//
// The Server-Component page at /referral-partners/[id] fetches the
// partner row, its Primary / Owner contacts, and the "Contacts at this
// company" list, then hands them to this client component. The Worksheet
// is editable in place: every column listed on issue #253 saves on blur,
// and the header row of four Lifecycle status flip buttons writes the
// new status with one click. No automated transitions of any kind —
// every state change is a deliberate user action.

import { useCallback, useMemo, useRef, useState } from "react";
import { Handshake } from "lucide-react";
import { formatPhoneNumber } from "@/lib/phone";
import {
  CALL_OUTCOMES,
  recomputeDenormalizedFields,
  type CallLogEntry,
  type CallOutcome,
} from "@/lib/referral-partner-call";

export interface ReferralPartnerForWorksheet {
  id: string;
  organization_id: string;
  company_name: string;
  status: "grey" | "yellow" | "green" | "red";
  industry: string | null;
  lead_source: string | null;
  operation_size: string | null;
  office_phone: string | null;
  office_email: string | null;
  website: string | null;
  address: string | null;
  referral_fee_terms: string | null;
  notes: string | null;
  primary_contact_id: string | null;
  owner_contact_id: string | null;
}

export interface ReferralContactForWorksheet {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

interface Props {
  partner: ReferralPartnerForWorksheet;
  primaryContact: ReferralContactForWorksheet | null;
  ownerContact: ReferralContactForWorksheet | null;
  contacts: ReferralContactForWorksheet[];
  initialCalls: CallLogEntry[];
}

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  spoke: "Spoke",
  not_interested: "Not interested",
  interested: "Interested",
  scheduled_followup: "Scheduled follow-up",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type LifecycleStatus = ReferralPartnerForWorksheet["status"];

const STATUS_CHIP_CLASS: Record<LifecycleStatus, string> = {
  grey: "bg-gray-200 text-gray-700",
  yellow: "bg-yellow-200 text-yellow-900",
  green: "bg-green-200 text-green-900",
  red: "bg-red-200 text-red-900",
};

const STATUS_BUTTON_CLASS: Record<LifecycleStatus, string> = {
  grey: "bg-gray-200 text-gray-700 hover:bg-gray-300",
  yellow: "bg-yellow-200 text-yellow-900 hover:bg-yellow-300",
  green: "bg-green-200 text-green-900 hover:bg-green-300",
  red: "bg-red-200 text-red-900 hover:bg-red-300",
};

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  grey: "Uncontacted",
  yellow: "In progress",
  green: "Active",
  red: "Declined",
};

const STATUS_ORDER: ReadonlyArray<LifecycleStatus> = [
  "grey",
  "yellow",
  "green",
  "red",
];

// One editable text field. The Worksheet's edit pattern is save-on-blur:
// the user types, the field shows the typed value, on blur we PATCH only
// if the value changed. An identical-on-blur is a no-op (no empty saves,
// no toasts on unchanged fields).
function EditableField({
  label,
  partnerId,
  column,
  initial,
  multiline,
  formatOnBlur,
}: {
  label: string;
  partnerId: string;
  column: string;
  initial: string | null;
  multiline?: boolean;
  formatOnBlur?: (v: string) => string;
}) {
  const [value, setValue] = useState(initial ?? "");
  const baselineRef = useRef(initial ?? "");

  const onBlur = async () => {
    const formatted = formatOnBlur ? formatOnBlur(value) : value;
    if (formatted !== value) setValue(formatted);
    if (formatted === baselineRef.current) return;
    baselineRef.current = formatted;
    await fetch(`/api/referral-partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [column]: formatted }),
    });
  };

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-[var(--brand-primary)] focus:outline-none";

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`worksheet-field-${column}`}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={`worksheet-field-${column}`}
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          rows={3}
          className={inputClass}
        />
      ) : (
        <input
          id={`worksheet-field-${column}`}
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          className={inputClass}
        />
      )}
    </div>
  );
}

// One Primary or Owner contact slot. Display-only in this slice — wiring
// the linked-contact picker lands in a later slice (#6).
function ContactSlot({
  testId,
  heading,
  contact,
}: {
  testId: string;
  heading: string;
  contact: ReferralContactForWorksheet | null;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-border bg-card px-5 py-4"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {heading}
      </p>
      {contact ? (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{contact.full_name}</p>
          {contact.phone && (
            <p className="text-sm text-muted-foreground">
              {formatPhoneNumber(contact.phone)}
            </p>
          )}
          {contact.email && (
            <p className="text-sm text-muted-foreground">{contact.email}</p>
          )}
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">Not set</p>
      )}
    </div>
  );
}

export function ReferralPartnerWorksheet({
  partner,
  primaryContact,
  ownerContact,
  contacts,
  initialCalls,
}: Props) {
  // Local Lifecycle status drives the chip + active-button ring; we
  // update it optimistically on click so the user sees the new label
  // without a reload (PRD #249 #28, issue #253 AC #2 & #3).
  const [status, setStatus] = useState<LifecycleStatus>(partner.status);

  const flipStatus = useCallback(
    async (next: LifecycleStatus) => {
      if (next === status) return;
      setStatus(next);
      await fetch(`/api/referral-partners/${partner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    },
    [partner.id, status],
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <Handshake size={22} className="text-primary shrink-0" />
          <h1 className="text-2xl font-heading font-semibold text-foreground">
            {partner.company_name}
          </h1>
          <span
            data-testid="worksheet-lifecycle-status-chip"
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP_CLASS[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>

        {/* ── LIFECYCLE STATUS FLIP BUTTONS ────────────────────────────── */}
        {/* All four buttons are always visible — any status can transition
            to any other status with one click. No automated transitions. */}
        <div
          data-testid="worksheet-lifecycle-flip-buttons"
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Lifecycle status"
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`worksheet-lifecycle-flip-${s}`}
              aria-label={`Set Lifecycle status to ${STATUS_LABEL[s]}`}
              aria-pressed={status === s}
              onClick={() => flipStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-shadow ${STATUS_BUTTON_CLASS[s]} ${
                status === s ? "ring-2 ring-foreground/40" : ""
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </header>

      {/* ── COMPANY INFO (every column editable) ──────────────────────── */}
      <section
        data-testid="worksheet-company-info"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Company info
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <EditableField
            label="Company name"
            partnerId={partner.id}
            column="company_name"
            initial={partner.company_name}
          />
          <EditableField
            label="Industry"
            partnerId={partner.id}
            column="industry"
            initial={partner.industry}
          />
          <EditableField
            label="Lead source"
            partnerId={partner.id}
            column="lead_source"
            initial={partner.lead_source}
          />
          <EditableField
            label="Operation size"
            partnerId={partner.id}
            column="operation_size"
            initial={partner.operation_size}
          />
          <EditableField
            label="Office phone"
            partnerId={partner.id}
            column="office_phone"
            initial={
              partner.office_phone
                ? formatPhoneNumber(partner.office_phone) ?? partner.office_phone
                : null
            }
            formatOnBlur={(v) => formatPhoneNumber(v) ?? v}
          />
          <EditableField
            label="Office email"
            partnerId={partner.id}
            column="office_email"
            initial={partner.office_email}
          />
          <EditableField
            label="Website"
            partnerId={partner.id}
            column="website"
            initial={partner.website}
          />
          <EditableField
            label="Address"
            partnerId={partner.id}
            column="address"
            initial={partner.address}
          />
          <div className="sm:col-span-2">
            <EditableField
              label="Referral-fee terms"
              partnerId={partner.id}
              column="referral_fee_terms"
              initial={partner.referral_fee_terms}
            />
          </div>
          <div className="sm:col-span-2">
            <EditableField
              label="Notes"
              partnerId={partner.id}
              column="notes"
              initial={partner.notes}
              multiline
            />
          </div>
        </div>
      </section>

      {/* ── PRIMARY + OWNER CONTACT SLOTS ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ContactSlot
          testId="worksheet-primary-contact"
          heading="Primary contact"
          contact={primaryContact}
        />
        <ContactSlot
          testId="worksheet-owner-contact"
          heading="Owner contact"
          contact={ownerContact}
        />
      </div>

      {/* ── CONTACTS AT THIS COMPANY ──────────────────────────────────── */}
      <section
        data-testid="worksheet-contacts-list"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Contacts at this company
        </p>
        {contacts.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No contacts yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((c) => (
              <li key={c.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-medium text-foreground">{c.full_name}</p>
                <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                  {c.phone && <span>{formatPhoneNumber(c.phone)}</span>}
                  {c.email && <span>{c.email}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── CALL LOG ─────────────────────────────────────────────────── */}
      <CallLogSection
        partnerId={partner.id}
        initialCalls={initialCalls}
        contacts={contacts}
        primaryContactId={partner.primary_contact_id}
      />
    </div>
  );
}

// The Call log section — chronological history (newest first) plus the
// inline "Log a call" form (PRD #249, issue #254). Submitting the form
// POSTs to /api/referral-partners/[id]/calls; on success the new row is
// prepended to local state and the denormalized last-call info is
// recomputed locally via the pure rule so the UI reflects the same
// values the server just wrote to the partner row.
function CallLogSection({
  partnerId,
  initialCalls,
  contacts,
  primaryContactId,
}: {
  partnerId: string;
  initialCalls: CallLogEntry[];
  contacts: ReferralContactForWorksheet[];
  primaryContactId: string | null;
}) {
  const [calls, setCalls] = useState<CallLogEntry[]>(initialCalls);
  const [outcome, setOutcome] = useState<CallOutcome>("spoke");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [contactId, setContactId] = useState<string>(primaryContactId ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Sort newest-first by called_at so the most recent call sits at the top
  // regardless of insert order in `initialCalls`.
  const sortedCalls = useMemo(
    () => [...calls].sort((a, b) => (a.called_at < b.called_at ? 1 : -1)),
    [calls],
  );

  // Compute denormalized fields locally so the section header updates the
  // moment a call lands, without a server round-trip. The rule is shared
  // with the server's POST handler — same input, same output.
  const denormalized = useMemo(
    () =>
      recomputeDenormalizedFields(calls, {
        now: new Date().toISOString(),
      }),
    [calls],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/referral-partners/${partnerId}/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome,
        notes: notes.trim() || null,
        follow_up_at: followUpAt || null,
        referral_contact_id: contactId || null,
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { call: CallLogEntry };
      setCalls((prev) => [body.call, ...prev]);
      setNotes("");
      setFollowUpAt("");
    }
    setSubmitting(false);
  };

  return (
    <section
      data-testid="worksheet-call-log"
      className="rounded-lg border border-border bg-card px-5 py-4"
    >
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Call log
        </p>
        {denormalized.last_called_at && denormalized.last_call_outcome && (
          <p
            data-testid="worksheet-last-call-summary"
            className="text-xs text-muted-foreground"
          >
            Last call: {formatDate(denormalized.last_called_at)} —{" "}
            {OUTCOME_LABEL[denormalized.last_call_outcome]}
            {denormalized.next_follow_up_at && (
              <>
                {" • Next follow-up: "}
                {formatDate(denormalized.next_follow_up_at)}
              </>
            )}
          </p>
        )}
      </div>

      {/* ── Log a call form ──────────────────────────────────────────── */}
      <form
        onSubmit={onSubmit}
        className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-border bg-background p-3"
        data-testid="worksheet-log-call-form"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="log-call-contact"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Referral contact
          </label>
          <select
            id="log-call-contact"
            aria-label="Referral contact"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">— Unspecified —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="log-call-outcome"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Outcome
          </label>
          <select
            id="log-call-outcome"
            aria-label="Outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label
            htmlFor="log-call-notes"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Call notes
          </label>
          <textarea
            id="log-call-notes"
            aria-label="Call notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="log-call-follow-up"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Follow-up date
          </label>
          <input
            id="log-call-follow-up"
            type="date"
            aria-label="Follow-up date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--brand-primary)] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Log call
          </button>
        </div>
      </form>

      {/* ── History ──────────────────────────────────────────────────── */}
      {sortedCalls.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No calls logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sortedCalls.map((c) => (
            <li
              key={c.id}
              data-testid={`call-log-entry-${c.id}`}
              className="py-2 first:pt-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-foreground text-sm">
                  {OUTCOME_LABEL[c.outcome] ?? c.outcome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(c.called_at)}
                </p>
              </div>
              {c.follow_up_at && (
                <p className="text-xs text-muted-foreground">
                  Follow-up: {formatDate(c.follow_up_at)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
