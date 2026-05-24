import { redirect } from "next/navigation";

export default function ExportRedirectPage() {
  redirect("/settings/data?tab=export");
}
