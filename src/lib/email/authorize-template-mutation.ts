import {
  evaluatePermissionRule,
  type PermissionFacts,
} from "@/lib/request-context/evaluate-permission-rule";

export type EmailTemplateScope = "organization" | "personal";

// The app-layer permission gate for mutating an email template. RLS isolates
// rows by organization and owner, but it cannot enforce Nookleus' granular
// `manage_email_templates` permission (those grants live in our own tables,
// not the JWT). So the rule lives here: an organization-wide template may only
// be created/edited/deleted by a caller who holds `manage_email_templates`
// (admins auto-pass), while a personal template is always the owner's to manage.
export function authorizeTemplateMutation(
  scope: EmailTemplateScope,
  facts: PermissionFacts,
): boolean {
  if (scope === "personal") return true;
  return evaluatePermissionRule(
    { permission: "manage_email_templates" },
    facts,
  );
}
