import {
  Building2,
  Palette,
  ListChecks,
  Users,
  Mail,
  FileSignature,
  FileText,
  Download,
  Send,
  CircleDollarSign,
  Library,
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
  { href: "/settings/company", label: "Company Profile", icon: Building2 },
  { href: "/settings/appearance", label: "Appearance", icon: Palette },
  { href: "/settings/jobs", label: "Jobs", icon: ListChecks },
  { href: "/settings/item-library", label: "Item Library", icon: Library },
  {
    href: "/settings/estimate-templates",
    label: "Estimate Templates",
    icon: LayoutTemplate,
  },
  { href: "/settings/pdf-presets", label: "PDF Presets", icon: FileText },
  { href: "/settings/money", label: "Money", icon: CircleDollarSign },
  { href: "/settings/people", label: "People", icon: Users },
  { href: "/settings/email", label: "Email Accounts", icon: Mail },
  {
    href: "/settings/signatures",
    label: "Email Signatures",
    icon: FileSignature,
  },
  {
    href: "/settings/contract-templates",
    label: "Contract Templates",
    icon: FileText,
  },
  { href: "/settings/contracts", label: "Contracts", icon: Send },
  { href: "/settings/payments", label: "Outgoing Emails", icon: Mail },
  { href: "/settings/reports", label: "Reports", icon: FileText },
  { href: "/settings/data", label: "Data", icon: Download },
];
