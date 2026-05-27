// PRD #304 — Nookleus Phone. The inbound-event decision tree. Pure: no
// I/O, no Supabase, no HTTP. The webhook route is a thin shell that
// validates the Twilio signature, calls this function, and persists.
//
// Inputs the route hands in:
//   - the Twilio webhook payload (From, To, Body),
//   - every active `phone_numbers` row in the org (the webhook narrows by
//     `To`),
//   - the org's contacts (the webhook narrows by `From` via phone-format),
//   - the contacts' Active jobs (the webhook narrows by contactId).
//
// Outputs a `RouteInboundDecision` the webhook then turns into row writes,
// or null when the inbound does not target any of the org's numbers.

import { findContactByPhone, normalizePhoneToE164 } from "@/lib/phone";
import {
  decideJobTag,
  type ActiveJob,
  type SmartAttachDecision,
} from "./smart-attach";

// The slice of `phone_numbers` rows this module needs. The webhook hands
// in the org's full set; the module narrows on `To`.
export interface PhoneNumberForRoute {
  id: string;
  organization_id: string;
  e164: string;
  kind: "shared" | "personal";
  user_id: string | null;
  released_at?: string | null;
}

// The slice of `contacts` rows this module needs.
export interface ContactForRoute {
  id: string;
  phone: string | null | undefined;
}

// The Twilio inbound webhook fields this module reads. Twilio sends many
// more (FromCity, FromZip, MessageSid, etc.); the route is responsible
// for persisting whatever else it cares about — this module only needs
// the three routing fields.
export interface TwilioInboundPayload {
  From: string;
  To: string;
  Body: string;
}

export interface RouteInboundInput {
  payload: TwilioInboundPayload;
  orgNumbers: PhoneNumberForRoute[];
  contacts: ContactForRoute[];
  activeJobsByContact: Record<string, ActiveJob[]>;
}

export interface ConversationKey {
  phoneNumberId: string;
  outsideE164: string;
}

export interface RouteInboundDecision {
  organizationId: string;
  phoneNumberId: string;
  phoneNumberKind: "shared" | "personal";
  phoneNumberOwnerId: string | null;
  outsideE164: string;
  conversationKey: ConversationKey;
  contactId: string | null;
  smartAttach: SmartAttachDecision;
}

export function routeInbound(input: RouteInboundInput): RouteInboundDecision | null {
  const toE164 = normalizePhoneToE164(input.payload.To);
  const fromE164 = normalizePhoneToE164(input.payload.From);
  if (!toE164 || !fromE164) return null;

  // Match the To address to one of the org's active numbers. Released
  // numbers are dead to us — Twilio still has them for a short window,
  // and the row stays for audit, but new inbound on a released number
  // is a no-op.
  const number = input.orgNumbers.find(
    (n) => n.e164 === toE164 && !n.released_at,
  );
  if (!number) return null;

  // Match the From address to a Contact. May be null (unknown number).
  const contact = findContactByPhone(input.contacts, fromE164);
  const contactId = contact ? contact.id : null;
  const activeJobs = contactId
    ? input.activeJobsByContact[contactId] ?? []
    : [];

  const smartAttach = decideJobTag({
    direction: "in",
    sourceContext: { kind: "inbound" },
    contactId,
    activeJobs,
  });

  return {
    organizationId: number.organization_id,
    phoneNumberId: number.id,
    phoneNumberKind: number.kind,
    phoneNumberOwnerId: number.user_id,
    outsideE164: fromE164,
    conversationKey: { phoneNumberId: number.id, outsideE164: fromE164 },
    contactId,
    smartAttach,
  };
}
