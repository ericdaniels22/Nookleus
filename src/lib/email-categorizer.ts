export type Category = "jobs" | "general" | "promotions" | "social" | "purchases";

/**
 * Curated seed of common US insurance-carrier sender domains. Callers merge
 * this with the org's own adjuster addresses to build the ClaimContext, so a
 * first email from a carrier files into Jobs before any Job exists to match.
 * Suffix-matched, so subdomains (e.g. claims.statefarm.com) are covered.
 */
export const INSURANCE_CARRIER_DOMAINS: readonly string[] = [
  "statefarm.com",
  "allstate.com",
  "libertymutual.com",
  "farmers.com",
  "nationwide.com",
  "progressive.com",
  "geico.com",
  "usaa.com",
  "travelers.com",
  "thehartford.com",
  "chubb.com",
  "amfam.com",
  "erieinsurance.com",
  "safeco.com",
  "aaa.com",
];

/**
 * A claim number is the word "claim" followed (allowing a "#/no./number/id"
 * connector and separators) by an identifier that contains at least one digit.
 * The digit requirement keeps prose like "claims processing" from matching.
 */
const CLAIM_NUMBER_PATTERN =
  /\bclaims?\b[\s:#.-]*(?:no\.?|number|num\.?|id|#)?[\s:#.-]*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{4,}/i;

export interface CategoryRule {
  match_type: "sender_address" | "sender_domain" | "header" | "body_pattern" | "subject_pattern";
  match_value: string;
  category: Category;
}

export interface EmailForCategorization {
  from_address: string;
  subject: string;
  headers?: Record<string, string>;
  body_text?: string | null;
}

/**
 * Org-scoped claim signals used to file claim-looking mail into the Jobs
 * bucket even before a Job exists to match against.
 *   - carrierDomains: insurance-carrier sender domains (suffix match), a
 *     curated seed plus any org additions.
 *   - adjusterAddresses: exact adjuster/carrier sender addresses drawn from
 *     the org's job adjusters.
 */
export interface ClaimContext {
  carrierDomains?: string[];
  adjusterAddresses?: string[];
}

/**
 * Categorize an email by matching against a pre-loaded list of rules.
 * Match order (first match wins):
 *   1. sender_address (exact, case-insensitive)
 *   2. sender_domain (suffix match on domain portion of from_address)
 *   3. header (case-insensitive presence of the named header)
 *   4. body_pattern (case-insensitive regex match against body_text)
 *   5. subject_pattern (case-insensitive regex match against subject)
 * Fallback: "general".
 */
export function categorizeEmail(
  email: EmailForCategorization,
  rules: CategoryRule[],
  claim?: ClaimContext
): Category {
  const fromLower = email.from_address.toLowerCase();
  const subject = email.subject || "";
  const headers = email.headers || {};
  const bodyText = email.body_text || "";

  // Extract domain from "name@domain.tld" — take everything after the last "@"
  const atIdx = fromLower.lastIndexOf("@");
  const fromDomain = atIdx >= 0 ? fromLower.slice(atIdx + 1) : "";

  // 1. sender_address exact match
  for (const rule of rules) {
    if (rule.match_type === "sender_address") {
      if (rule.match_value.toLowerCase() === fromLower) {
        return rule.category;
      }
    }
  }

  // 2. sender_domain suffix match
  for (const rule of rules) {
    if (rule.match_type === "sender_domain") {
      const target = rule.match_value.toLowerCase();
      if (fromDomain === target || fromDomain.endsWith("." + target)) {
        return rule.category;
      }
    }
  }

  // 3. header presence
  for (const rule of rules) {
    if (rule.match_type === "header") {
      const headerName = rule.match_value.toLowerCase();
      if (headerName in headers) {
        return rule.category;
      }
    }
  }

  // 4. body_pattern regex
  if (bodyText) {
    for (const rule of rules) {
      if (rule.match_type === "body_pattern") {
        try {
          const re = new RegExp(rule.match_value, "i");
          if (re.test(bodyText)) {
            return rule.category;
          }
        } catch {
          // Invalid regex in DB — skip
        }
      }
    }
  }

  // 5. subject_pattern regex
  for (const rule of rules) {
    if (rule.match_type === "subject_pattern") {
      try {
        const re = new RegExp(rule.match_value, "i");
        if (re.test(subject)) {
          return rule.category;
        }
      } catch {
        // Invalid regex in DB — skip
      }
    }
  }

  // Claim signal: a claim-number pattern in the subject or body marks the mail
  // as claim-looking → Jobs, even before any Job exists to match. Runs after
  // explicit rules so a rule always wins over the heuristic.
  const claimHaystack = `${subject} ${bodyText}`;
  if (CLAIM_NUMBER_PATTERN.test(claimHaystack)) {
    return "jobs";
  }

  // Known adjuster sender address (exact, case-insensitive).
  const adjusterAddresses = claim?.adjusterAddresses || [];
  for (const addr of adjusterAddresses) {
    if (addr.toLowerCase() === fromLower) {
      return "jobs";
    }
  }

  // Known insurance-carrier sender domain (exact or subdomain suffix).
  const carrierDomains = claim?.carrierDomains || [];
  for (const domain of carrierDomains) {
    const target = domain.toLowerCase();
    if (fromDomain === target || fromDomain.endsWith("." + target)) {
      return "jobs";
    }
  }

  return "general";
}
