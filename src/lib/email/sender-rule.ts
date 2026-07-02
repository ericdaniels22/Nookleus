import type { Category } from "@/lib/email-categorizer";

/**
 * The insertable columns of a Sender rule — a `category_rules` row that files a
 * specific sender address into a chosen bucket. Created when a user moves an
 * email and taps "always file this sender here" (issue #957, ADR 0028). `id`
 * and `created_at` are left to DB defaults.
 */
export interface SenderRule {
  match_type: "sender_address";
  match_value: string;
  category: Category;
  organization_id: string;
  is_active: true;
}

/**
 * Build an org-scoped, active Sender rule from a raw from-address. The address
 * is normalized (trimmed + lowercased) to match how `categorizeEmail` compares
 * `sender_address` rules, so the rule reliably hits the sender's future mail.
 */
export function buildSenderRule(
  fromAddress: string,
  category: Category,
  organizationId: string,
): SenderRule {
  return {
    match_type: "sender_address",
    match_value: fromAddress.trim().toLowerCase(),
    category,
    organization_id: organizationId,
    is_active: true,
  };
}

/** The email fields `shouldRefile` needs to decide whether re-filing is safe. */
export interface RefileCandidate {
  category: string | null;
  category_locked: boolean | null;
}

/**
 * Decide whether an existing email should be re-filed into `targetCategory`
 * when a new Sender rule is created. A manual move always wins, so a
 * `category_locked` email is never touched; an email already in the target
 * bucket is a no-op. Everything else moves.
 */
export function shouldRefile(email: RefileCandidate, targetCategory: Category): boolean {
  if (email.category_locked) return false;
  if (email.category === targetCategory) return false;
  return true;
}
