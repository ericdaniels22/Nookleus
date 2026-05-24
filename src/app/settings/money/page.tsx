import { SettingsTabs } from "@/components/settings/settings-tabs";
import { VendorsTab } from "./vendors-tab";
import { ExpenseCategoriesTab } from "./expense-categories-tab";
import { QuickbooksTab } from "./quickbooks-tab";
import { StripeTab } from "./stripe-tab";

// Stripe + QuickBooks tabs call `cookies()` via createServerSupabaseClient
// during render. `force-dynamic` matches what /settings/stripe/page.tsx
// declared before the redesign so the page never gets statically cached.
export const dynamic = "force-dynamic";

// #230 — Slice 4 of the Settings redesign collapses four pages into one.
// The page is a server component so QuickbooksTab and StripeTab can do
// their server-side auth gating + connection fetches with first-paint
// data, the same way the standalone /settings/accounting and
// /settings/stripe pages did before the redesign.
//
// VendorsTab and ExpenseCategoriesTab are pure client components that
// load their own data via /api/settings/*; QuickbooksTab and StripeTab
// are async server components that render their existing client bodies
// with the connection summary as a prop.

export default function MoneySettingsPage() {
  return (
    <SettingsTabs
      defaultTab="vendors"
      tabs={[
        { key: "vendors", label: "Vendors", content: <VendorsTab /> },
        {
          key: "expense-categories",
          label: "Expense Categories",
          content: <ExpenseCategoriesTab />,
        },
        { key: "quickbooks", label: "QuickBooks", content: <QuickbooksTab /> },
        { key: "stripe", label: "Stripe", content: <StripeTab /> },
      ]}
    />
  );
}
