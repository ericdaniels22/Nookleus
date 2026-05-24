import { redirect } from "next/navigation";

export default function StatusesRedirectPage() {
  redirect("/settings/jobs?tab=statuses");
}
