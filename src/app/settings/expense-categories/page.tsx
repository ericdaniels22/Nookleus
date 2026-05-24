import { redirect } from "next/navigation";

// #230 — old URL preserved as a redirect into the combined /settings/money
// shell. The page body lives at
// src/app/settings/money/expense-categories-tab.tsx.
export default function ExpenseCategoriesRedirectPage() {
  redirect("/settings/money?tab=expense-categories");
}
