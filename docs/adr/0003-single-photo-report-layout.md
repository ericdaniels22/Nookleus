# Single hardcoded photo report layout

Photo reports previously supported per-template cover pages and configurable
layouts via the `photo_report_templates` table. With the May 2026 rework
(see issue #326), photo reports converge on **one** hardcoded layout — fixed
cover page, fixed header/footer, fixed section divider page, fixed before/after
pair behavior. The only remaining knob is `report_photos_per_page` (1/2/4).

We picked one layout over a template system because every photo report this
business produces serves the same audience (insurance adjusters and property
owners) and benefits from looking the same every time. The template machinery
was being maintained for flexibility nobody used, and dragging that flexibility
forward into the rework would have doubled the surface area of the cover-page
and footer code for no current need.

## Consequences

- `photo_report_templates` table and `PhotoReportTemplate.cover_page` JSON
  become dead code. They are not dropped yet — existing rows are harmless and
  removing the table is a separate migration.
- `photo_report_defaults` loses `default_report_template`, `report_preparer_name`,
  and `report_footer_text`. Only `report_photos_per_page` survives.
- Reintroducing template choice later means rebuilding the template system,
  not toggling it back on.
- Existing PDFs in the `reports` bucket are not regenerated — they keep the
  old layout as a historical record.

## Amended (May 2026, #361 — slice 1 of #360)

The original rework left `report_photos_per_page` as "the only remaining knob"
but never wired it through: the generator silently read the **per-template**
`photo_report_templates.photos_per_page` column for the body layout, so the
Settings → Report Defaults control did nothing. This is now corrected.

- **Photos-per-page is global**, sourced from
  `company_settings.report_photos_per_page` (a key/value row, stored as the
  string `"1" | "2" | "4"`, default `"2"`). The new pure module
  `resolvePhotosPerPage()` (`src/lib/resolve-photos-per-page.ts`) is the single
  place that parses and validates that string into a `1 | 2 | 4`, falling back
  to `2` for missing/empty/invalid values.
- The per-template **`photo_report_templates.photos_per_page` column is now dead
  at render time**, exactly like `cover_page` JSON already is. The generator no
  longer reads it.
- A report's **`template_id` is preset provenance only** — it no longer
  influences rendering. Reports created under the old template-bound flow
  generate correctly under the global value.
- The `photo_report_templates` table and its `photos_per_page` column are not
  dropped (still dead data, a separate migration). No schema change or migration
  accompanies this amendment.
