import { redirect } from "next/navigation";

export default function ContractTemplatesRedirectPage() {
  redirect("/settings/templates?tab=contracts");
}
