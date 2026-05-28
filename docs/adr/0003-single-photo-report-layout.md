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
