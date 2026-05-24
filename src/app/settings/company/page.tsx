"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ProfileTab } from "./profile-tab";
import { BrandingTab } from "./branding-tab";

export default function CompanySettingsPage() {
  return (
    <SettingsTabs
      defaultTab="profile"
      tabs={[
        { key: "profile", label: "Profile", content: <ProfileTab /> },
        { key: "branding", label: "Branding", content: <BrandingTab /> },
      ]}
    />
  );
}
