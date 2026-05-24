import { redirect } from "next/navigation";

export default function KnowledgeRedirectPage() {
  redirect("/settings/data?tab=knowledge-base");
}
