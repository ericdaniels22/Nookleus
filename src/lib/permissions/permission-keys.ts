// The canonical permission-key vocabulary — the single source of truth for
// every permission key the platform recognises (#96, under PRD #95).
//
// Before this module the vocabulary was fragmented across three places that
// had already drifted apart: the `settings/users` route seeded one list of
// keys for new members, the `settings/users` management UI showed a second
// (shorter) list, and route/page gates referenced a third set of string
// literals — including keys present in neither list, so no non-admin could
// ever be granted them. Everything now derives from `PERMISSION_CATALOG`.
//
// `PERMISSION_CATALOG` is the data; the rest is derived:
//   - `PermissionKey`   — the union type a permission rule may name. Wiring
//                         it into `PermissionRule.permission` makes "no rule
//                         names an unknown key" a typechecker-enforced
//                         invariant rather than a convention.
//   - `PERMISSION_KEYS` — every key, used to seed a new member's grants.
//   - `PERMISSION_GROUPS` — the ordered group headings the management UI
//                         renders permissions under.
//
// Catalog order is display order; group order follows first appearance.

export interface PermissionDescriptor {
  /** The stored `permission_key` value — what gates and grants reference. */
  key: string;
  /** Human-readable name shown in the permission-management UI. */
  label: string;
  /** UI grouping heading. */
  group: string;
}

export const PERMISSION_CATALOG = [
  { key: "view_jobs", label: "View Jobs", group: "Jobs" },
  { key: "edit_jobs", label: "Edit Jobs", group: "Jobs" },
  { key: "create_jobs", label: "Create Jobs", group: "Jobs" },

  { key: "log_activities", label: "Log Activities", group: "Activity" },

  { key: "upload_photos", label: "Upload Photos", group: "Photos" },
  { key: "edit_photos", label: "Edit/Annotate Photos", group: "Photos" },

  { key: "view_estimates", label: "View Estimates", group: "Estimates" },
  { key: "create_estimates", label: "Create Estimates", group: "Estimates" },
  { key: "edit_estimates", label: "Edit Estimates", group: "Estimates" },
  { key: "convert_estimates", label: "Convert Estimates to Invoices", group: "Estimates" },
  { key: "manage_estimates", label: "Manage Estimates", group: "Estimates" },

  { key: "view_invoices", label: "View Invoices", group: "Invoices" },
  // create_invoices retired in #386: invoices now only come into existence by
  // converting an approved estimate (convert_estimates), never authored directly.
  { key: "edit_invoices", label: "Edit Invoices", group: "Invoices" },
  { key: "manage_invoices", label: "Manage Invoices", group: "Invoices" },

  { key: "view_billing", label: "View Billing", group: "Billing" },
  { key: "record_payments", label: "Record Payments", group: "Billing" },

  { key: "view_accounting", label: "View Accounting", group: "Accounting" },
  { key: "manage_accounting", label: "Manage Accounting", group: "Accounting" },
  { key: "log_expenses", label: "Log Expenses", group: "Accounting" },

  { key: "view_email", label: "View Email", group: "Email" },
  { key: "send_email", label: "Send Email", group: "Email" },

  // PRD #304 — Nookleus Phone (in-app text and call with customers).
  // Defaults live in `role-defaults.ts`: Admin ON, Crew Lead ON, Crew Member OFF.
  { key: "view_phone", label: "View Phone", group: "Phone" },

  { key: "manage_reports", label: "Manage Reports", group: "Reports" },

  { key: "manage_templates", label: "Manage Estimate Templates", group: "Templates" },
  { key: "manage_contract_templates", label: "Manage Contract Templates", group: "Templates" },
  { key: "manage_email_templates", label: "Manage Email Templates", group: "Templates" },

  { key: "manage_item_library", label: "Manage Item Library", group: "Catalogs" },
  { key: "manage_vendors", label: "Manage Vendors", group: "Catalogs" },
  { key: "manage_expense_categories", label: "Manage Expense Categories", group: "Catalogs" },
  { key: "manage_pdf_presets", label: "Manage PDF Presets", group: "Catalogs" },

  { key: "access_settings", label: "Access Settings", group: "Admin" },
] as const satisfies readonly PermissionDescriptor[];

/** A permission key a rule, gate, or grant may name. */
export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

/** A permission-management UI group heading. */
export type PermissionGroup = (typeof PERMISSION_CATALOG)[number]["group"];

/** Every canonical permission key, in catalog order. */
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map(
  (p) => p.key,
);

/** The UI group headings, in the order they first appear in the catalog. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  ...new Set(PERMISSION_CATALOG.map((p) => p.group)),
];
