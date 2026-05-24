import { redirect } from "next/navigation";

export default function SignaturesRedirectPage() {
  redirect("/settings/email?tab=signatures");
}
