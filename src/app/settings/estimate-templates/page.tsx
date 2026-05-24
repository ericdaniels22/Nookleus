import { redirect } from "next/navigation";

export default function EstimateTemplatesRedirectPage() {
  redirect("/settings/templates?tab=estimates");
}
