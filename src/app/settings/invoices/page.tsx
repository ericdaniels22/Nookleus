import { redirect } from "next/navigation";

export default function InvoicesRedirectPage() {
  redirect("/settings/outgoing?tab=invoices");
}
