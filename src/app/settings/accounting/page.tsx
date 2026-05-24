import { redirect } from "next/navigation";

// #230 — old URL preserved as a redirect into the combined /settings/money
// shell. The page body lives at src/app/settings/money/quickbooks-tab.tsx
// (which does the same server-side auth gate + connection fetch the old
// /settings/accounting page used to do).
export default function AccountingRedirectPage() {
  redirect("/settings/money?tab=quickbooks");
}
