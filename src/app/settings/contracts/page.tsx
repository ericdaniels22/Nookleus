import { redirect } from "next/navigation";

export default function ContractsRedirectPage() {
  redirect("/settings/outgoing?tab=contracts");
}
