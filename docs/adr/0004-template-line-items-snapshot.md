# Estimate template line items are snapshots, not library references

When a Library item is added to an Estimate template, the template stores a
**full copy** of the item's fields (name, description, code, unit, quantity,
unit_price) plus a soft `library_item_id` pointer that records where the copy
came from. Subsequent edits to the underlying Library item do **not**
propagate into existing templates. Custom items (no library reference) are
allowed and store the same fields directly.

This replaces the build 67b/67e "library-only" pattern, in which the template
structure stored only `library_item_id` plus a few overrides
(`description_override`, `quantity_override`, `unit_price_override`) and
`apply_template_to_estimate` resolved `name`, `code`, and `unit` from the
Library at apply time.

We picked snapshot semantics over live-from-library because:

- **Templates are user-authored documents, not derived views.** A contractor
  who saved a template last month expects it to look the same next month.
  Library edits silently rewriting templates is spooky-action-at-a-distance.
- **The builder UI already lets users edit name/code/unit per row.** Before
  this change, those edits were accepted in the UI and silently dropped on
  save (issue #350). Snapshot semantics let those edits do what they
  obviously look like they should do.
- **Custom items need somewhere to live anyway.** Once we accept that a
  template item must be able to store its own name (for the Custom case),
  the schema asymmetry between Library-backed and Custom items is gone, and
  the cleanest model is "every template item just stores its own state."
- **Library deletes stop silently corrupting templates.** Under the old
  model, deleting a Library item left dangling references that
  `apply_template_to_estimate` would turn into `[unknown item]` placeholders.
  Snapshots are immune.

## Consequences

- `TemplateStructureItem` shape changes: `description_override`,
  `quantity_override`, `unit_price_override` are replaced by plain
  `name`, `description`, `code`, `unit`, `quantity`, `unit_price`.
  `library_item_id` stays as a nullable soft pointer.
- One-time migration walks every existing template, looks up each
  `library_item_id` in `item_library`, and writes the snapshot. Items whose
  Library item has been deleted, and items already created via the Custom
  tab (which silently lost name/code/unit before this change), need manual
  cleanup — they get whatever stub data the old structure preserved.
- `apply_template_to_estimate` no longer reads from `item_library`. It
  copies values straight out of the template structure into the new
  estimate's line items. The `broken_refs` return value becomes vestigial
  (kept only for items the migration couldn't backfill).
- Library renames are intentional one-way: editing a Library item updates
  only future template items, not existing ones. If a user wants the new
  name in an existing template, they delete the row and re-add it.
- The Custom tab in `AddItemDialog` (template mode) becomes fully
  functional rather than silently lossy.

## Update (#353 — dual-shape removed)

Issues #352 and #353 have since completed the transition:

- **#352** backfilled every existing template's `structure` into the flat
  snapshot shape, so no row relies on `*_override` or library resolution any
  more.
- **#353** dropped the transitional code. `TemplateStructureItem` no longer
  carries the `*_override` fields; `synthItemFromTemplate` reads the flat fields
  only; and `apply_template_to_estimate` (migration-353) no longer reads
  `item_library` at apply time. With no library lookup, apply can no longer
  produce a broken reference, so the `broken_refs` return value — and the
  post-apply banner that consumed it — were removed entirely. `library_item_id`
  survives purely as a soft breadcrumb copied straight from the structure. The
  NOT-NULL insert floors (`'[unknown item]'`, qty 1, price 0) remain, since the
  line-item columns still require non-null values.
