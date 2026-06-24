export interface ContractEmailFrameInput {
  // The signing-request email (#691) and the reminder (#692) both render in
  // this frame and carry the action button; the union widens further as the
  // remaining PRD email kinds (confirmation, internal) adopt the shared frame.
  kind: "signing_request" | "reminder";
  companyName: string;
  logoUrl: string | null;
  logoVisible: boolean;
  buttonLabel: string;
  buttonColor: string;
  senderName: string;
  senderEmail: string;
  // Already run through sanitizeEmailHtmlForSend by the caller — the frame is
  // assembled AROUND it, never through the sanitizer (see ADR 0017 §3).
  message: string;
  actionUrl: string;
  documentTitle: string;
}

// Escapes text destined for HTML text nodes or double-quoted attributes. The
// message is already sanitized HTML and is embedded verbatim; everything the
// frame itself injects (labels, urls, names) goes through here.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Renders the app-owned, table-based, inline-styled branded card around the
// contractor's sanitized message. Pure: string in → string out.
export function renderContractEmailFrame(input: ContractEmailFrameInput): string {
  const buttonTextColor = contrastingTextColor(input.buttonColor);
  const company = escapeHtml(input.companyName);
  const showLogo = input.logoVisible && !!input.logoUrl;

  // Brand lockup: a real logo when the contractor has one and wants it shown,
  // otherwise a typographic wordmark of the company name leads the card.
  const brandHeader = showLogo
    ? `<div style="margin-bottom:20px;">` +
      `<img src="${escapeHtml(input.logoUrl as string)}" alt="${company}" ` +
      `style="display:block;max-height:48px;max-width:220px;border:0;"></div>`
    : `<div style="margin-bottom:20px;font-size:22px;font-weight:700;` +
      `color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;">${company}</div>`;

  // Footer Nookleus mark sized by logo presence: a tiny "Powered by" credit
  // when the contractor's own logo leads, a prominent standalone mark when it
  // doesn't (#691).
  const footer = showLogo
    ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;` +
      `font-family:Arial,Helvetica,sans-serif;">Powered by Nookleus</p>`
    : `<div style="margin:24px 0 0;font-size:18px;font-weight:700;color:#6b7280;` +
      `font-family:Arial,Helvetica,sans-serif;">Nookleus</div>`;

  // A glyph sits above the headline: the document icon for the initial send,
  // a reminder bell for the nudge (#692). The remaining kinds (confirmation,
  // internal) swap it further in later slices.
  const glyph = input.kind === "reminder" ? "🔔" : "📄";
  const documentIcon =
    `<div style="font-size:40px;line-height:1;margin-bottom:12px;">${glyph}</div>`;

  // The reminder reads as a nudge ("…is waiting for your signature"); the
  // initial send announces the document. Same card chrome and button either way
  // (ADR 0017 §4) — only the headline copy differs by kind.
  const headlineText =
    input.kind === "reminder"
      ? `Reminder: ${company} is waiting for your signature`
      : `${company} sent you a document to review and sign`;
  const headline =
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1a1a1a;` +
    `font-family:Arial,Helvetica,sans-serif;">` +
    `${headlineText}</h1>`;

  const senderLine =
    `<p style="margin:0 0 16px;font-size:14px;color:#4b5563;` +
    `font-family:Arial,Helvetica,sans-serif;">From ${escapeHtml(input.senderName)} ` +
    `(${escapeHtml(input.senderEmail)})</p>`;

  const actionButton =
    `<a href="${escapeHtml(input.actionUrl)}" ` +
    `style="display:inline-block;background-color:${escapeHtml(input.buttonColor)};` +
    `color:${buttonTextColor};text-decoration:none;font-weight:600;` +
    `padding:14px 28px;border-radius:6px;font-size:16px;">` +
    `${escapeHtml(input.buttonLabel)}</a>`;

  const cardBody =
    brandHeader +
    documentIcon +
    headline +
    senderLine +
    `<div style="font-size:15px;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;">` +
    `${input.message}</div>` +
    `<div style="text-align:center;margin-top:24px;">${actionButton}</div>` +
    footer;

  // Bulletproof, table-based, inline-styled shell so the card holds together
  // on mobile and across Gmail / Apple Mail / Outlook.
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background-color:#f3f4f6;margin:0;padding:0;">` +
    `<tr><td align="center" style="padding:24px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;` +
    `border:1px solid #e5e7eb;">` +
    `<tr><td style="padding:32px;">${cardBody}</td></tr>` +
    `</table></td></tr></table>`
  );
}

// Picks a legible text color for a label sitting on `buttonColorHex`, using
// the YIQ perceived-brightness threshold (the contractor may freely set the
// button color, including red — the label must stay readable on any of them).
// Mirrors the chip-contrast math in report-pdf/tag-chips.tsx, but lives here
// as a standalone pure helper (that one is bound to a "use client" react-pdf
// module and can't be imported into the email path).
export function contrastingTextColor(buttonColorHex: string): "#ffffff" | "#1a1a1a" {
  const m = /^#?([0-9a-f]{6})$/i.exec(buttonColorHex.trim());
  if (!m) return "#1a1a1a";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 150 ? "#1a1a1a" : "#ffffff";
}
