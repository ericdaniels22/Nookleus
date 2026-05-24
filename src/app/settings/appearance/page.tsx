import { redirect } from "next/navigation";

export default function AppearanceRedirectPage() {
  redirect("/settings/company?tab=branding");
}
