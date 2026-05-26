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
import { useRouter } from "next/navigation";
import { Handshake, Trash2 } from "lucide-react";
import { formatPhoneNumber } from "@/lib/phone";
import {
  CALL_OUTCOMES,
  recomputeDenormalizedFields,
  type CallLogEntry,
  type CallOutcome,
} from "@/lib/referral-partner-call";
import { shouldOfferCreate } from "@/lib/insurance-picker";
import type { NewReferralContactInput } from "@/lib/referral-contact-form";

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

// One Primary or Owner contact slot. Renders the current contact's details
// and a dropdown that lists every Referral Contact at this company — so the
// user can promote a newly added contact to Primary/Owner without leaving
// the Worksheet (issue #255 AC #3). Changing the selection PATCHes the FK
// on the partner row. The full linked-contact picker (search, type-ahead,
// etc.) is the concern of a later slice (#6).
function ContactSlot({
  testId,
  heading,
  column,
  partnerId,
  contact,
  contacts,
}: {
  testId: string;
  heading: string;
  column: "primary_contact_id" | "owner_contact_id";
  partnerId: string;
  contact: ReferralContactForWorksheet | null;
  contacts: ReferralContactForWorksheet[];
}) {
  const [selectedId, setSelectedId] = useState<string>(contact?.id ?? "");
  const selectId = `worksheet-${column}`;

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setSelectedId(next);
    await fetch(`/api/referral-partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [column]: next || null }),
    });
  };

  const selectedContact =
    contacts.find((c) => c.id === selectedId) ?? contact ?? null;

  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-border bg-card px-5 py-4"
    >
      <label
        htmlFor={selectId}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block"
      >
        {heading}
      </label>
      <select
        id={selectId}
        aria-label={heading}
        value={selectedId}
        onChange={onChange}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-[var(--brand-primary)] focus:outline-none mb-2"
      >
        <option value="">— Not set —</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name}
          </option>
        ))}
      </select>
      {selectedContact ? (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{selectedContact.full_name}</p>
          {selectedContact.phone && (
            <p className="text-sm text-muted-foreground">
              {formatPhoneNumber(selectedContact.phone)}
            </p>
          )}
          {selectedContact.email && (
            <p className="text-sm text-muted-foreground">{selectedContact.email}</p>
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
  contacts: initialContacts,
  initialCalls,
}: Props) {
  // Local Lifecycle status drives the chip + active-button ring; we
  // update it optimistically on click so the user sees the new label
  // without a reload (PRD #249 #28, issue #253 AC #2 & #3).
  const [status, setStatus] = useState<LifecycleStatus>(partner.status);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  // Local contacts state so the inline + Add contact form can prepend a
  // new Referral Contact and surface it in the list, the Primary contact
  // dropdown, and the Owner contact dropdown on the SAME render — without
  // any page reload (issue #255 AC #3).
  const [contacts, setContacts] = useState<ReferralContactForWorksheet[]>(
    initialContacts,
  );

  const addContact = useCallback((c: ReferralContactForWorksheet) => {
    setContacts((prev) => [c, ...prev]);
  }, []);

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

  // Soft-delete the Referral Partner: confirm, POST /delete, then return
  // the user to the list page. The partner disappears from the default
  // list (which filters `deleted_at IS NULL`) and reappears in Trash
  // (issue #256).
  const onDelete = useCallback(async () => {
    if (deleting) return;
    if (
      !confirm(
        `Move "${partner.company_name}" to the Trash? You'll have 30 days to restore it before it's permanently deleted.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch(
      `/api/referral-partners/${partner.id}/delete`,
      { method: "POST" },
    );
    if (!res.ok) {
      setDeleting(false);
      alert("Couldn't delete this Referral Partner.");
      return;
    }
    router.push("/referral-partners");
    router.refresh();
  }, [deleting, partner.company_name, partner.id, router]);

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
          <button
            type="button"
            data-testid="worksheet-delete-button"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete Referral Partner"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
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
          column="primary_contact_id"
          partnerId={partner.id}
          contact={primaryContact}
          contacts={contacts}
        />
        <ContactSlot
          testId="worksheet-owner-contact"
          heading="Owner contact"
          column="owner_contact_id"
          partnerId={partner.id}
          contact={ownerContact}
          contacts={contacts}
        />
      </div>

      {/* ── CONTACTS AT THIS COMPANY ──────────────────────────────────── */}
      <section
        data-testid="worksheet-contacts-list"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <div className="flex items-center justify-between mb-3 gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contacts at this company
          </p>
          <AddContactAffordance
            partnerId={partner.id}
            existingNames={contacts.map((c) => c.full_name)}
            onAdded={addContact}
          />
        </div>
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

// Inline "+ Add contact" affordance on the Call Worksheet (PRD #249, issue
// #255). A button reveals a 4-field form (name / number / email / note);
// submitting POSTs to /api/referral-partners/[id]/contacts and hands the
// new Referral Contact back up to the parent so it surfaces in the list
// AND both Primary/Owner contact dropdowns on the SAME render (no reload).
//
// The "save is offered" guard reuses `shouldOfferCreate` from
// `src/lib/insurance-picker.ts` (PRD #47) — typing a duplicate name (case-
// insensitive, exact match against existing Referral Contacts at this
// company) withholds the save button so loose duplicates aren't created.
function AddContactAffordance({
  partnerId,
  existingNames,
  onAdded,
}: {
  partnerId: string;
  existingNames: string[];
  onAdded: (c: ReferralContactForWorksheet) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewReferralContactInput>({
    full_name: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: keyof NewReferralContactInput, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Same gate the insurance-picker uses — only offer save when the typed
  // name is non-empty AND not an exact, case-insensitive match for an
  // existing Referral Contact at this company.
  const canSave = shouldOfferCreate(form.full_name, existingNames);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/referral-partners/${partnerId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name,
        phone: form.phone,
        email: form.email,
        notes: form.notes,
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        contact: {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
        };
      };
      onAdded({
        id: body.contact.id,
        full_name: body.contact.full_name,
        phone: body.contact.phone,
        email: body.contact.email,
      });
      setForm({ full_name: "", phone: "", email: "", notes: "" });
      setOpen(false);
    }
    setSubmitting(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
      >
        + Add contact
      </button>
    );
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-[var(--brand-primary)] focus:outline-none";

  return (
    <form
      onSubmit={onSubmit}
      data-testid="worksheet-add-contact-form"
      className="w-full rounded-md border border-border bg-background p-3 grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-contact-name"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Name
        </label>
        <input
          id="add-contact-name"
          aria-label="Name"
          value={form.full_name}
          onChange={(e) => setField("full_name", e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-contact-number"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Number
        </label>
        <input
          id="add-contact-number"
          aria-label="Number"
          value={form.phone}
          onChange={(e) => setField("phone", e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-contact-email"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Email
        </label>
        <input
          id="add-contact-email"
          aria-label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-contact-note"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Note
        </label>
        <input
          id="add-contact-note"
          aria-label="Note"
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border bg-card text-muted-foreground px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave || submitting}
          className="rounded-md bg-[var(--brand-primary)] text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Save contact
        </button>
      </div>
    </form>
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
