import { redirect } from "next/navigation";

export default function PdfPresetsRedirectPage() {
  redirect("/settings/company?tab=branding");
}
