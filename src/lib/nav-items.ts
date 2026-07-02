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

export interface NavGroup {
  /** Eyebrow label rendered above the group. Null = pinned section without
   *  an eyebrow (Jarvis at the top of the sidebar). */
  label: string | null;
  items: NavItem[];
}

/**
 * Canonical grouped sidebar structure (docs/design-system.md §5, #912):
 * Jarvis pinned top · Work · Comms · Business. Settings is pinned to the
 * sidebar bottom (with the workspace switcher and user footer) and lives in
 * `settingsNavItem`, not a group.
 *
 * Groups and the order of items inside them are fixed by the design system.
 * The nav_items DB table (`sort_order`, managed in Settings → Navigation)
 * reorders items *within* their group only — see src/components/nav.tsx.
 */
export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/jarvis", label: "Jarvis", icon: Sparkles }],
  },
  {
    label: "Work",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/intake", label: "Intake", icon: ClipboardPlus },
      { href: "/photos", label: "Photos", icon: Camera },
      // Photo Reports are reached only through their Job (#400 / ADR 0009):
      // the standalone /reports area was removed. Created from a Job's Photos
      // tab, listed/reopened from the Job's Overview tab.
    ],
  },
  {
    label: "Comms",
    items: [
      { href: "/email", label: "Email", icon: Mail },
      // Phone sits between Email and Contacts (§5; originally PRD #304 /
      // #306, regrouped by #912). Gated on view_phone — defaults Admin=ON,
      // Crew Lead=ON, Crew Member=OFF.
      { href: "/phone", label: "Phone", icon: Phone, requiredPermission: "view_phone" },
      { href: "/contacts", label: "Contacts", icon: Users },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/accounting", label: "Accounting", icon: Calculator },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
      // Referral Partners is gated to admin and crew_lead since referral-fee
      // terms and decline reasons aren't crew_member-visible (PRD #249).
      { href: "/referral-partners", label: "Referral Partners", icon: Handshake,
        requiredRoles: ["admin", "crew_lead"] },
    ],
  },
];

/** Pinned to the sidebar bottom alongside the workspace switcher and user
 *  footer (§5) — rendered outside the scrollable group list. */
export const settingsNavItem: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
};

/**
 * Flat list of every sidebar item, derived from the grouped structure.
 * Kept as an export for consumers that don't care about grouping (e.g.
 * Settings → Navigation ordering). The array order is the default fallback
 * used when an item is not yet present in the nav_items DB table.
 */
export const navItems: NavItem[] = [
  ...navGroups.flatMap((group) => group.items),
  settingsNavItem,
];
