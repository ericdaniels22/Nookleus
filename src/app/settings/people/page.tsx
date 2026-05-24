"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { UsersCrewTab } from "./users-crew-tab";
import { NotificationsTab } from "./notifications-tab";

export default function PeopleSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="users"
      tabs={[
        { key: "users", label: "Users & Crew", content: <UsersCrewTab /> },
        { key: "notifications", label: "Notifications", content: <NotificationsTab /> },
      ]}
    />
  );
}
