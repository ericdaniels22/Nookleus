"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { QuickPickLabelsTab } from "./quick-pick-labels-tab";

export default function PhotosSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="quick-pick-labels"
      tabs={[
        {
          key: "quick-pick-labels",
          label: "Quick-pick Labels",
          content: <QuickPickLabelsTab />,
        },
      ]}
    />
  );
}
