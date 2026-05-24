import { redirect } from "next/navigation";

export default function NotificationsRedirectPage() {
  redirect("/settings/people?tab=notifications");
}
