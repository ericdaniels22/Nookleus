"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AccountsTab } from "./accounts-tab";
import { SignaturesTab } from "./signatures-tab";
import { TemplatesTab } from "./templates-tab";

export default function EmailSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="accounts"
      tabs={[
        { key: "accounts", label: "Accounts", content: <AccountsTab /> },
        { key: "signatures", label: "Signatures", content: <SignaturesTab /> },
        { key: "templates", label: "Templates", content: <TemplatesTab /> },
      ]}
    />
  );
}
