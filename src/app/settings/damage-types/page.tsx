import { redirect } from "next/navigation";

export default function DamageTypesRedirectPage() {
  redirect("/settings/jobs?tab=damage-types");
}
