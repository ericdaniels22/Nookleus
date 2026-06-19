// Buzz-wording for a new-intake notification: the pure mapping from a Job's
// customer-facing facts to the title/body/sound/deep-link a bell row (and a
// later push) carries. Title and sound vary by the Job's **Urgency** tier; an
// 🚨 emergency leads the title. See docs/adr/0018-new-intake-push-notifications.md.

export type IntakeUrgency = "emergency" | "urgent" | "scheduled";

export interface IntakeBuzzInput {
  jobId: string;
  customerName: string;
  urgency: IntakeUrgency;
  damageType: string | null;
  propertyAddress: string | null;
}

export interface IntakeBuzz {
  title: string;
  body: string;
  sound: string;
  href: string;
}

const TIERS: Record<IntakeUrgency, { titlePhrase: string; sound: string }> = {
  emergency: { titlePhrase: "🚨 EMERGENCY intake", sound: "emergency.caf" },
  urgent: { titlePhrase: "Urgent intake", sound: "urgent.caf" },
  scheduled: { titlePhrase: "New intake", sound: "scheduled.caf" },
};

export function buildIntakeBuzz(input: IntakeBuzzInput): IntakeBuzz {
  const tier = TIERS[input.urgency];
  const customerName = input.customerName?.trim();
  const title = customerName
    ? `${tier.titlePhrase}: ${customerName}`
    : tier.titlePhrase;

  // Join the facts we have; drop blank/missing ones so the body never shows a
  // dangling separator or a literal "null". Both missing → a generic fallback.
  const parts = [input.damageType, input.propertyAddress]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const body = parts.length > 0 ? parts.join(" · ") : "New job";

  return {
    title,
    body,
    sound: tier.sound,
    href: `/jobs/${input.jobId}`,
  };
}
