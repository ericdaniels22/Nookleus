"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { StatusesTab } from "./statuses-tab";
import { DamageTypesTab } from "./damage-types-tab";
import { IntakeFormTab } from "./intake-form-tab";

export default function JobsSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="statuses"
      tabs={[
        { key: "statuses", label: "Statuses", content: <StatusesTab /> },
        { key: "damage-types", label: "Damage Types", content: <DamageTypesTab /> },
        { key: "intake-form", label: "Intake Form", content: <IntakeFormTab /> },
      ]}
    />
  );
}
