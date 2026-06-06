# A document's PDF layout is a per-document snapshot, resolved by precedence

**Status:** Accepted
**Date:** 2026-06-06 — documents the design decisions for issue #387 (live PDF layout options panel for estimates & invoices)

## Context

Issue #387 adds a layout-options panel beside the live PDF View of an Estimate
or Invoice: a set of show/hide switches (markup, discount, tax, opening
statement, closing statement, code column, category subtotals, document title,
item notes) plus an editable document-title text, with the preview re-rendering
live as switches flip. The same look must apply when the PDF is exported or
sent, not just on screen.

A `PdfPreset` system already exists in code (`src/lib/pdf-presets.ts`,
`pdf_presets`) but was explicitly left **out of scope** by
[ADR 0007](0007-estimates-are-the-single-billing-entry-point.md) (it "belongs to
issue #379's other two asks"). Nothing today governs how a *per-document* look
relates to those reusable presets, what happens to that look once a document is
frozen, or how the two are resolved at render time. Those are the questions this
ADR settles, because the answers shape the schema (a snapshot column vs. a
foreign key) and a behavioural guarantee (frozen documents keep their look) that
are both costly to change after data exists.

Two terms are now first-class and qualified by document to avoid the long-running
"preset" / "template" / "layout" overload (see the **PDF preset** and **PDF
layout** entries in [CONTEXT.md](../../CONTEXT.md)):

- **PDF preset** — a saved, reusable set of look-preferences belonging to an
  Organization. Exactly one is the Organization's **default preset**.
- **PDF layout** — the show/hide choices one specific Estimate or Invoice
  actually renders with, stored on that document.

## Decision

1. **A document's PDF layout is a snapshot, not a reference.** The moment a user
   changes any switch on a document, that document gets its **own complete copy**
   of the look (all switches plus the title text), stored on the document itself —
   not a `preset_id` pointing back at a preset. Editing a preset later never
   reaches back and changes documents already made. This follows the house
   snapshot-over-live-reference stance set by
   [ADR 0004](0004-template-line-items-snapshot.md): a document's appearance is a
   user-authored fact about *that document*, not a derived view of current preset
   state, and silent "spooky-action-at-a-distance" rewrites are exactly what we
   avoid.

2. **Taking a layout copies the whole look — never half-and-half.** A document
   either has no layout of its own (and renders from the default preset) or has a
   complete layout. The first switch-flip seeds the document's layout from the
   currently-effective look and from then on the document follows only itself.
   There is no partial overlay where some switches come from the document and the
   rest still track the preset.

3. **The look is resolved by a pure precedence rule.** A single pure function
   resolves the effective look at render time: **the document's own layout wins;
   absent a layout, the Organization's default preset applies.** The renderer,
   the on-screen preview, the export path, and the send path all call the same
   resolver, so what is sent or exported is byte-for-byte the look shown in the
   preview.

4. **A frozen document's layout is locked.** Once an Estimate is converted and
   once an Invoice is paid or voided, its PDF layout can no longer be changed —
   the same boundary [ADR 0007](0007-estimates-are-the-single-billing-entry-point.md)
   draws for editing the document ("no edits once paid or voided") and the
   record-integrity principle [ADR 0011](0011-signed-contract-pdfs-are-immutable.md)
   sets for signed artifacts. Everything earlier in the lifecycle (a draft
   estimate, a sent-but-unpaid invoice) stays freely editable. The layout panel
   is read-only on a frozen document; its stored layout still drives rendering so
   the frozen document keeps looking exactly as it did.

5. **"Document title" is a switch plus editable text, carried per document.** The
   ninth toggle turns the title on or off, and an accompanying text field edits
   the title words. Both the on/off state and the text are part of the document's
   layout snapshot, so a renamed title travels with the document like every other
   choice.

6. **Layout changes autosave.** There is no explicit "save layout" action on the
   document — flipping a switch or editing the title persists to the document's
   layout. ("Save as preset" is a separate, deliberate action; see below.)

7. **Permissions reuse existing boundaries.** Changing one document's layout
   requires the same permission as editing that document. Saving a reusable,
   Organization-wide preset (including "Save as preset" from the panel) requires
   the manage-presets permission.

## Consequences

- **Schema:** each of `estimates` and `invoices` gains a nullable `pdf_layout`
  JSONB column holding the snapshot (`NULL` = "no layout of its own, use the
  default preset"), plus a `show_document_title` boolean inside that shape since
  the title is now a per-document toggle. A hand-written `DocumentPdfLayout` type
  is added to `src/lib/types.ts` (manual migrations, no gen-types — consistent
  with the rest of the repo).
- **Item notes reuse #382's `show_item_notes`** rather than introducing a parallel
  flag; the layout snapshot carries the same field name the renderer already
  understands.
- **Storing a snapshot, not a `preset_id`, is a deliberate denormalization.** A
  future reader will ask "why not just store which preset this document uses?" —
  the answer is decisions 1 and 2: a document must keep its look even as presets
  change or are deleted, exactly as template line items keep their values when the
  library changes (ADR 0004). The column is intentionally redundant with whatever
  preset it was seeded from.
- **Default-preset fallback must always resolve to *something*.** When a document
  has no layout and the Organization has no default preset, the resolver falls
  back to the field-level defaults (the column defaults the `pdf_presets` shape
  already carries). The render path never has "no look."
- **No relayout of frozen documents — and no endpoint that would allow it.** As
  with [ADR 0011](0011-signed-contract-pdfs-are-immutable.md)'s refusal to add a
  regenerate-signed-PDF path, a future "let me re-skin this old approved estimate"
  request must not be answered by mutating the frozen document's layout. The
  approved/paid record is what the customer saw; changing its look after the fact
  would misrepresent it.
- **One resolver, four call sites.** Centralizing the precedence rule in a single
  pure function (testable in isolation) is what guarantees preview/export/send
  parity; any path that renders a billing PDF without going through it is a bug.

## Considered options

- **Store a `preset_id` reference instead of a snapshot.** Rejected: editing or
  deleting a preset would silently change or break the look of past documents —
  the spooky-action-at-a-distance ADR 0004 already ruled out for templates, and
  worse here because some of those documents are frozen legal/financial records.
- **Partial overlay (document overrides specific switches, the rest track the
  preset).** Rejected: it makes "what does this document actually look like?"
  depend on live preset state, defeating the snapshot guarantee and complicating
  both the resolver and the frozen-document lock. Whole-look copy is simpler and
  matches user intuition ("this document looks the way I left it").
- **Let frozen documents be re-laid-out, showing only an ephemeral preview.**
  Rejected: it invites exactly the record-integrity problem ADR 0007 and ADR 0011
  guard against — the on-screen look diverging from, or quietly replacing, the
  look the customer approved or paid against.
- **Explicit "Save layout" button on the document.** Rejected: the look *is* the
  document's state, not a draft to be committed; autosave matches how the rest of
  the document edits behave. The deliberate-commit affordance is reserved for the
  cross-document action ("Save as preset").
