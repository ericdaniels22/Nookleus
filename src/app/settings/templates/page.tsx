"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { EstimatesTab } from "./estimates-tab";
import { ContractsTab } from "./contracts-tab";
import { ItemLibraryTab } from "./item-library-tab";
import { PhotoReportDefaultsTab } from "./photo-report-defaults-tab";
import { PhotoReportTemplatesTab } from "./photo-report-templates-tab";

export default function TemplatesSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="estimates"
      tabs={[
        { key: "estimates", label: "Estimates", content: <EstimatesTab /> },
        { key: "contracts", label: "Contracts", content: <ContractsTab /> },
        { key: "item-library", label: "Item Library", content: <ItemLibraryTab /> },
        {
          key: "photo-report-templates",
          label: "Photo Report Templates",
          content: <PhotoReportTemplatesTab />,
        },
        {
          key: "photo-report-defaults",
          label: "Photo Report Defaults",
          content: <PhotoReportDefaultsTab />,
        },
      ]}
    />
  );
}
