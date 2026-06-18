# Contract emails render in an app-owned branded frame

**Status:** Proposed
**Date:** 2026-06-17 (issue #687)

## Context

A contract email today *is* its template. When an Organization sends a
contract, the recipient gets a plain HTML email whose entire body is a
rich-text template the Organization edits in Settings → Contracts
(`contract_email_settings`), with merge fields and a `{{signing_link}}` token
resolved at send time (`resolveEmailTemplate` → `sendContractEmail`). The
seeded default is four short paragraphs and a bare text link:

> Hi {{customer_name}}, Please review and sign **{{document_title}}** at the
> link below. … [Open document]({{signing_link}}) Thanks, {{company_name}}

The HTML is sent verbatim — there is no wrapper, no logo, no styled button.
The same plain-paragraph shape is used by all four contract emails (initial
send, reminder, post-sign confirmation to the customer, internal staff
notification).

Issue #687 asks for the recipient-facing email to look like a polished,
DocuSign-style branded card: company logo, a document icon, a centered
headline ("{Company} sent you a document to review and sign"), a prominent
action button, a sender line, and a short message — i.e. structure, not just
prettier prose.

The tension this surfaces: the editing surface is a **rich-text** editor
(paragraphs, bold, links, merge-field pills). It cannot represent a card, a
logo block, or a real button. So "keep the whole email editable" and "look
like the screenshot" cannot both be fully true — the polished chrome only
exists if something *other than* the rich-text body draws it.

Considered options:

- **A — App owns the frame (chosen).** Nookleus renders a fixed branded layout
  (card, logo, icon, headline, button, footer); the Organization controls only
  *content*: the message text, the button label, the button color, and whether
  the logo shows. The look is consistent and unbreakable.
- **B — Prettier default, body stays fully editable.** Ship a nicer seeded
  template but keep the whole email author-editable. Rejected: the rich-text
  editor can't express the card/button, so the polish would be fragile — one
  edit and it collapses back to paragraphs — and it would fight the
  newly-shipped email HTML sanitizer (#658/#665).
- **C — Raw HTML editor.** Give Organizations a true code editor to hand-build
  the card. Rejected: literal control, but it breaks across mail clients,
  collides head-on with the email sanitizer, and lets one bad edit silently
  wreck every customer's contract email.

## Decision

1. **The app owns the frame; the Organization owns the content.** Every
   contract email is rendered server-side into a trusted, table-based,
   inline-styled branded card. The Organization controls a bounded set of
   knobs: the rich-text **message** (greeting + description), the **button
   label**, the **button color** (one setting for all contract emails;
   default a professional dark tone, freely changeable — including red), and
   **logo on/off**. Layout, logo block, document icon, headline, sender line,
   button shape, and footer are app-drawn and not editable.

2. **The headline names the company, the From line names the sender.** The
   headline reads "{`company_name`} sent you a document to review and sign" —
   the brand the recipient recognizes, which matches the logo. The send-from
   name/email still control the technical From header and are mirrored in an
   in-body sender line, as in the reference screenshot.

3. **The frame is built *around* the sanitizer, never through it.** Only the
   Organization's typed message is run through the email HTML sanitizer
   (#658/#665); the app-owned frame is trusted and assembled outside it. Build
   order matters — sanitizing the assembled card would strip the table layout
   and button.

4. **All four contract emails share the frame.** Initial send and reminder
   carry the action button (the signing link). The post-sign confirmation
   shows a "signed ✓" icon instead of the document icon, carries **no** button,
   and keeps the attached signed PDF. The internal staff notification carries a
   "View contract" button to the internal platform view (the
   `contract_platform_url` extra already exists). Because the app injects the
   signing link into the button, the body no longer needs to contain
   `{{signing_link}}`, and the send route's "body must contain the signing-link
   token" guard is removed.

5. **Nookleus branding appears on every contract email, as a deliberate growth
   lever.** When an Organization has uploaded a logo, that logo leads and a
   small "Powered by Nookleus" sits in the footer. When it has *not*, the
   company **name** leads as a text wordmark and the Nookleus presence is more
   prominent. The recipient is the contractor's customer (e.g. a homeowner) who
   does not know Nookleus, so the contractor's identity always leads — the
   Nookleus mark is never the primary brand on the card.

6. **A preview is available in two places:** live in Settings → Contracts while
   editing the template, and in the Send dialog showing the *real* email with
   the selected job/customer's merge data resolved.

7. **Existing templates reset to the new default.** Switching models discards
   per-Organization body customizations in favor of a fresh default message
   inside the card. The prior body value is retained (inactive) in the database
   rather than hard-deleted, so nothing is irrecoverable.

## Consequences

- `contract_email_settings` gains content/style columns (button label, button
  color, logo-visible flag) and the email-rendering path gains a server-side
  frame builder shared by all four emails. The body templates stop being
  free-form HTML and become the message region only.
- The branding rule (Nookleus on every email, sized by logo presence) is a
  standing product/marketing decision, not a styling default — it is the reason
  a future reader will find a platform mark on a white-labelled customer email,
  and it is deliberate.
- Button color is Organization-chosen, so the renderer must guarantee legible
  contrast (auto-flip the button text to dark on pale colors).
- The migration is one-way for active bodies; the retained old value is a
  safety net, not a supported rollback path.
- This is a design decision recorded ahead of implementation — status
  **Proposed** until the build lands, at which point it moves to **Accepted**.
