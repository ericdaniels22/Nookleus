"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PhoneNumbersTab } from "./phone-numbers-tab";
import { OptOutsTab } from "./opt-outs-tab";
import { RecordingSettingsTab } from "./recording-settings-tab";

// PRD #304 — Nookleus Phone. Slice 3 (#307) opened the page with a single
// Numbers tab. Slice 5 (#309) adds an Opt-outs tab; slice 11 (#315) adds the
// org-level call-recording default.

export default function PhoneSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="numbers"
      tabs={[
        { key: "numbers", label: "Numbers", content: <PhoneNumbersTab /> },
        { key: "opt-outs", label: "Opt-outs", content: <OptOutsTab /> },
        {
          key: "recording",
          label: "Recording",
          content: <RecordingSettingsTab />,
        },
      ]}
    />
  );
}
