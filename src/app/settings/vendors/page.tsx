import { redirect } from "next/navigation";

// #230 — old URL preserved as a redirect into the combined /settings/money
// shell. The page body lives at src/app/settings/money/vendors-tab.tsx.
export default function VendorsRedirectPage() {
  redirect("/settings/money?tab=vendors");
}
