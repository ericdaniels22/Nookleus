// Read-only Call Worksheet (PRD #249, issue #252).
//
// The page-level Server Component fetches a Referral Partner, its Primary
// contact, its Owner contact, and every Referral Contact at the company, then
// hands them to this presentational component. This slice ships *read-only*:
// no editing, no Lifecycle-status flip buttons, no "Log a call" form, no
// "+ Add contact" affordance. Those land in slices #4, #5, and #6.

import { Handshake } from "lucide-react";
import { formatPhoneNumber } from "@/lib/phone";

// The columns from `referral_partners` this surface needs. The page fetches
// the row with `select('*')` so the shape it hands in carries everything;
// we name just the columns the Worksheet actually reads so the prop type
// stays a contract rather than a free-for-all.
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

// The minimum fields the Worksheet needs from a linked Referral Contact —
// name + phone + email — to render the Primary / Owner contact slots and
// the "Contacts at this company" list. The underlying `contacts` row has
// more columns; this is the read-only slice's view.
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
}

// Lifecycle-status display values. Mirrors the labels used on the list page
// (`src/app/referral-partners/page.tsx`) so the chip reads the same string
// the user already learned there.
const STATUS_CHIP_CLASS: Record<ReferralPartnerForWorksheet["status"], string> = {
  grey: "bg-gray-200 text-gray-700",
  yellow: "bg-yellow-200 text-yellow-900",
  green: "bg-green-200 text-green-900",
  red: "bg-red-200 text-red-900",
};

const STATUS_LABEL: Record<ReferralPartnerForWorksheet["status"], string> = {
  grey: "Uncontacted",
  yellow: "In progress",
  green: "Active",
  red: "Declined",
};

// One read-only label/value row used by both the company-info grid and the
// contact-slot detail lines. Empty `value` is rendered as an em-dash so
// missing columns are visually distinct from "Not set" (which is reserved
// for the contact-slot empty state in PRD #249).
function InfoRow({ label, value }: { label: string; value: string | null }) {
  const display = value && value.trim().length > 0 ? value : "—";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{display}</span>
    </div>
  );
}

// One Primary or Owner contact slot. Shows the linked Referral Contact's
// name + formatted phone + email when set; "Not set" otherwise (PRD #249
// #19, #29; issue #252 acceptance criteria).
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
}: Props) {
  const formattedOfficePhone = partner.office_phone
    ? formatPhoneNumber(partner.office_phone)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3">
        <Handshake size={22} className="text-primary shrink-0" />
        <h1 className="text-2xl font-heading font-semibold text-foreground">
          {partner.company_name}
        </h1>
        <span
          data-testid="worksheet-lifecycle-status-chip"
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP_CLASS[partner.status]}`}
        >
          {STATUS_LABEL[partner.status]}
        </span>
      </header>

      {/* ── COMPANY INFO ──────────────────────────────────────────────── */}
      <section
        data-testid="worksheet-company-info"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Company info
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <InfoRow label="Industry" value={partner.industry} />
          <InfoRow label="Lead source" value={partner.lead_source} />
          <InfoRow label="Operation size" value={partner.operation_size} />
          <InfoRow label="Office phone" value={formattedOfficePhone} />
          <InfoRow label="Office email" value={partner.office_email} />
          <InfoRow label="Website" value={partner.website} />
          <InfoRow label="Address" value={partner.address} />
          <InfoRow
            label="Referral-fee terms"
            value={partner.referral_fee_terms}
          />
        </div>
        {partner.notes && partner.notes.trim().length > 0 && (
          <div className="mt-4 flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </span>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {partner.notes}
            </p>
          </div>
        )}
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

      {/* ── CALL LOG (placeholder until slice #5) ─────────────────────── */}
      <section
        data-testid="worksheet-call-log"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Call log
        </p>
        <p className="text-sm italic text-muted-foreground">
          The Call log lands with the Log-a-call form in the next slice.
        </p>
      </section>
    </div>
  );
}
