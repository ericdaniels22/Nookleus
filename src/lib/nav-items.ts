import {
  LayoutDashboard,
  ClipboardPlus,
  Briefcase,
  Users,
  Camera,
  Mail,
  Phone,
  Settings,
  Sparkles,
  Megaphone,
  Calculator,
  Handshake,
} from "lucide-react";
import type { ComponentType } from "react";
import type { PermissionKey } from "@/lib/permissions/permission-keys";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Membership roles allowed to see this item. Undefined = visible to every
   *  authenticated member (the default for legacy items). */
  requiredRoles?: readonly string[];
  /** Permission key required to see this item. Admin auto-passes. Undefined =
   *  not gated on a permission (the default; legacy items rely on role gating
   *  or no gating at all). */
  requiredPermission?: PermissionKey;
}

/**
 * Canonical source of truth for which sidebar items exist.
 * The order in this array is the default fallback used when an
 * item is not yet present in the nav_items DB table (e.g., a new
 * page added in code before its migration row is created).
 *
 * The actual rendered order is determined by nav_items.sort_order
 * from the database — see src/lib/nav-order-context.tsx and
 * src/components/nav.tsx.
 */
export const navItems: NavItem[] = [
  { href: "/",          label: "Dashboard",  icon: LayoutDashboard },
  { href: "/jarvis",    label: "Jarvis",     icon: Sparkles },
  { href: "/marketing", label: "Marketing",  icon: Megaphone },
  // Referral Partners sits directly below Marketing — gated to admin and
  // crew_lead since referral-fee terms and decline reasons aren't
  // crew_member-visible (PRD #249).
  { href: "/referral-partners", label: "Referral Partners", icon: Handshake,
    requiredRoles: ["admin", "crew_lead"] },
  { href: "/intake",    label: "New Intake", icon: ClipboardPlus },
  { href: "/jobs",      label: "Jobs",       icon: Briefcase },
  { href: "/photos",    label: "Photos",     icon: Camera },
  // Photo Reports are reached only through their Job now (#400 / ADR 0009): the
  // standalone /reports area was removed. Created from a Job's Photos tab,
  // listed/reopened from the Job's Overview tab.
  { href: "/contacts",  label: "Contacts",   icon: Users },
  // Phone sits between Contacts and Email (PRD #304 / #306). Gated on
  // view_phone — defaults Admin=ON, Crew Lead=ON, Crew Member=OFF.
  { href: "/phone",     label: "Phone",      icon: Phone, requiredPermission: "view_phone" },
  { href: "/email",      label: "Email",      icon: Mail },
  { href: "/accounting", label: "Accounting", icon: Calculator },
  { href: "/settings",   label: "Settings",   icon: Settings },
];
