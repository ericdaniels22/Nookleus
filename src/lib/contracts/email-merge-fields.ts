import { applyMergeFieldValues, buildMergeFieldValues } from "./merge-fields";
import type { SupabaseClient } from "@supabase/supabase-js";

// Email templates support the same merge fields as contract templates
// plus two extras that only make sense at email-send time.
export const EMAIL_EXTRA_MERGE_FIELDS = [
  { name: "signing_link", label: "Signing Link" },
  { name: "document_title", label: "Document Title" },
] as const;

export interface EmailMergeExtras {
  signing_link: string;
  document_title: string;
  // Optional extras the caller can slot in for specific template types
  // (e.g. link back to the internal contract view for staff emails).
  contract_platform_url?: string;
}

// Resolves contract + email-extra merge fields against a job. Returns
// both the subject and body with tokens replaced — subject is plain text
// (entities decoded) and body is HTML.
export async function resolveEmailTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  jobId: string,
  extras: EmailMergeExtras,
): Promise<{ subject: string; html: string; unresolvedFields: string[] }> {
  const values = await buildMergeFieldValues(supabase, jobId);
  const withExtras: Record<string, string | null> = {
    ...values,
    signing_link: extras.signing_link,
    document_title: extras.document_title,
    contract_platform_url: extras.contract_platform_url ?? null,
  };

  // Subject is text, not HTML. Apply the same resolver but then decode
  // &amp;/&lt; etc. that the HTML-escape step introduced.
  const subjResult = applyMergeFieldValues(subjectTemplate, withExtras);
  const subject = decodeHtmlEntities(subjResult.html);

  // Body: pre-substitute signing_link so the URL always renders as a
  // clickable <a href> regardless of how the saved template body was
  // shaped. Without this, a body that lost its anchor wrapper (e.g.
  // `<p>Sign here: {{signing_link}}</p>`) would emit a plain URL string
  // and recipients would have to copy/paste — see the 15h handoff.
  const bodyTemplateWithLink = extras.signing_link
    ? substituteSigningLink(bodyTemplate, extras.signing_link)
    : bodyTemplate;
  const bodyResult = applyMergeFieldValues(bodyTemplateWithLink, withExtras);

  const unresolved = Array.from(new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]));
  return { subject, html: bodyResult.html, unresolvedFields: unresolved };
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Substitutes every {{signing_link}} occurrence in `html` with the resolved
// URL, preserving clickability across the three shapes a saved template
// body might land in:
//
//   1. <a href="{{signing_link}}">Open document</a>   (seeded default)
//   2. <span data-field-name="signing_link">…</span>  (Tiptap pill)
//   3. bare {{signing_link}} in body content          (user typed it)
//
// Pass 1 fills the href on existing anchors. Passes 2 and 3 wrap the
// remaining tokens in a fresh anchor so the URL is always clickable.
function substituteSigningLink(html: string, url: string): string {
  const anchor = `<a href="${escapeAttr(url)}">${escapeText(url)}</a>`;
  let out = html.replace(
    /href=(["'])\s*\{\{signing_link\}\}\s*\1/gi,
    (_m, quote: string) => `href=${quote}${escapeAttr(url)}${quote}`,
  );
  out = out.replace(
    /<span\b[^>]*\bdata-field-name=["']signing_link["'][^>]*>[\s\S]*?<\/span>/gi,
    () => anchor,
  );
  out = out.replace(/\{\{signing_link\}\}/gi, () => anchor);
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
