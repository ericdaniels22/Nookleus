import {
  Building2,
  Palette,
  ListChecks,
  Store,
  Receipt,
  Users,
  Mail,
  FileText,
  Download,
  Send,
  Link2,
  CreditCard,
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
  { href: "/settings/vendors", label: "Vendors", icon: Store },
  {
    href: "/settings/expense-categories",
    label: "Expense Categories",
    icon: Receipt,
  },
  { href: "/settings/people", label: "People", icon: Users },
  { href: "/settings/email", label: "Email", icon: Mail },
  {
    href: "/settings/contract-templates",
    label: "Contract Templates",
    icon: FileText,
  },
  { href: "/settings/contracts", label: "Contracts", icon: Send },
  { href: "/settings/accounting", label: "Accounting", icon: Link2 },
  { href: "/settings/stripe", label: "Stripe Payments", icon: CreditCard },
  { href: "/settings/payments", label: "Outgoing Emails", icon: Mail },
  { href: "/settings/reports", label: "Reports", icon: FileText },
  { href: "/settings/data", label: "Data", icon: Download },
];
