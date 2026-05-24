import { redirect } from "next/navigation";

export default function ItemLibraryRedirectPage() {
  redirect("/settings/templates?tab=item-library");
}
