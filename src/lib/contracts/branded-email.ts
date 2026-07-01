import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmailBranding } from "./email-branding";
import {
  renderContractEmailFrame,
  type ContractEmailFrameInput,
} from "./email-frame";
import { sanitizeEmailHtmlForSend } from "@/lib/email/sanitize-email-html";
import type { ContractEmailSettings } from "./types";

export interface BrandedContractEmailInput {
  // Which email kind the card renders as — the initial send / resend are
  // "signing_request", the nudge is "reminder" (#691/#692), and finalize's two
  // emails are "signed_confirmation" / "internal_notification" (#693).
  kind: ContractEmailFrameInput["kind"];
  organizationId: string;
  // The contractor's RAW message (pre-sanitize). This function sanitizes it.
  message: string;
  // The url injected into the card's action button — the signing link for the
  // customer paths, the internal platform view for the staff notification. Null
  // for the post-sign confirmation (#693), which draws no button at all.
  actionUrl: string | null;
  documentTitle: string;
}

/**
 * The one composition every contract email that wears the app-owned card runs:
 * sanitize the contractor's message FIRST, resolve branding, then assemble the
 * frame AROUND the sanitized message (#691/#692, ADR 0017 §3).
 *
 * The build order is load-bearing: the card's presentation tables/button must
 * never pass through sanitizeEmailHtmlForSend (its ALLOWED_TAGS has no
 * table/tr/td, so framing-then-sanitizing would strip the card). Centralizing
 * it here — instead of re-inlining it at the initial-send, reminder, and resend
 * call sites — makes that order impossible to get wrong at a new call site.
 *
 * The contractor controls only the message + the bounded branding knobs; the
 * frame, button, sender line, and signing link are app-owned.
 */
export async function renderBrandedContractEmail(
  supabase: SupabaseClient,
  settings: ContractEmailSettings,
  input: BrandedContractEmailInput,
): Promise<string> {
  const safeMessage = sanitizeEmailHtmlForSend(input.message);
  const branding = await loadEmailBranding(
    supabase,
    input.organizationId,
    settings,
  );
  return renderContractEmailFrame({
    kind: input.kind,
    companyName: branding.companyName ?? settings.send_from_name,
    logoUrl: branding.logoUrl,
    logoVisible: branding.logoVisible,
    buttonLabel: branding.buttonLabel,
    buttonColor: branding.buttonColor,
    senderName: settings.send_from_name,
    senderEmail: settings.send_from_email,
    message: safeMessage,
    actionUrl: input.actionUrl,
    documentTitle: input.documentTitle,
  });
}
