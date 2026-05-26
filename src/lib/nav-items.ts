import {
  LayoutDashboard,
  ClipboardPlus,
  Briefcase,
  Users,
  Camera,
  FileText,
  Mail,
  Settings,
  Sparkles,
  Megaphone,
  Calculator,
  Handshake,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Membership roles allowed to see this item. Undefined = visible to every
   *  authenticated member (the default for legacy items). */
  requiredRoles?: readonly string[];
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
  { href: "/reports",   label: "Reports",    icon: FileText },
  { href: "/contacts",  label: "Contacts",   icon: Users },
  { href: "/email",      label: "Email",      icon: Mail },
  { href: "/accounting", label: "Accounting", icon: Calculator },
  { href: "/settings",   label: "Settings",   icon: Settings },
];
