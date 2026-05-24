import {
  Building2,
  ListChecks,
  Users,
  Mail,
  Download,
  Send,
  CircleDollarSign,
  LayoutTemplate,
} from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
}

export const settingsNavItems: SettingsNavItem[] = [
  { href: "/settings/company", label: "Company", icon: Building2 },
  { href: "/settings/jobs", label: "Jobs", icon: ListChecks },
  { href: "/settings/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/settings/money", label: "Money", icon: CircleDollarSign },
  { href: "/settings/people", label: "People", icon: Users },
  { href: "/settings/email", label: "Email", icon: Mail },
  { href: "/settings/contracts", label: "Contracts", icon: Send },
  { href: "/settings/payments", label: "Outgoing Emails", icon: Mail },
  { href: "/settings/data", label: "Data", icon: Download },
];
