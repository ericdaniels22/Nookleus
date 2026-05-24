"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ExportTab } from "./export-tab";
import { KnowledgeBaseTab } from "./knowledge-base-tab";

export default function DataSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="export"
      tabs={[
        { key: "export", label: "Export", content: <ExportTab /> },
        {
          key: "knowledge-base",
          label: "Knowledge Base",
          content: <KnowledgeBaseTab />,
        },
      ]}
    />
  );
}
