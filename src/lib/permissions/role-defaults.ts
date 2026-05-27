// `ROLE_DEFAULTS` — the per-role default permission grants applied when a
// new member is seeded. The application-layer source of truth for
// `POST /api/settings/users`; the SQL function `set_default_permissions`
// mirrors this table at the database layer.
//
// Admin's entry is `PERMISSION_KEYS` (every catalog key) for consistency —
// admins auto-pass every rule regardless of grants. Crew Lead is the
// curated worker list. Crew Member is the minimal Job-only list. `custom`
// is the "no defaults" role used when an admin wants to hand-pick grants.
//
// Pinned by `role-defaults.test.ts` against the PRD tables that scope each
// new permission key (e.g. PRD #304 for `view_phone`).

import { PERMISSION_KEYS, type PermissionKey } from "./permission-keys";

export const ROLE_DEFAULTS: Record<string, readonly PermissionKey[]> = {
  admin: PERMISSION_KEYS,
  crew_lead: [
    "view_jobs", "edit_jobs", "create_jobs",
    "log_activities", "upload_photos", "edit_photos",
    "view_billing", "record_payments",
    "view_email", "send_email",
    "view_phone",
    "manage_reports",
  ],
  crew_member: ["view_jobs", "log_activities", "upload_photos"],
  custom: [],
};
