import { redirect } from "next/navigation";

export default function PaymentsRedirectPage() {
  redirect("/settings/outgoing?tab=payment-links");
}
