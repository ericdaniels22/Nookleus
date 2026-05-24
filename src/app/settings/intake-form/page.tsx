import { redirect } from "next/navigation";

export default function IntakeFormRedirectPage() {
  redirect("/settings/jobs?tab=intake-form");
}
