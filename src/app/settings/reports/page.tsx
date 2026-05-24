import { redirect } from "next/navigation";

export default function ReportsRedirectPage() {
  redirect("/settings/templates?tab=photo-report-defaults");
}
