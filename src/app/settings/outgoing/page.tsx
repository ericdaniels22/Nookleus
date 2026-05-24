"use client";

import { SettingsTabs } from "@/components/settings/settings-tabs";
import { OutgoingEmailEditor } from "@/components/settings/outgoing-email-editor";

export default function OutgoingEmailsSettingsPage() {
  return (
    <SettingsTabs
      defaultTab="invoices"
      tabs={[
        {
          key: "invoices",
          label: "Invoices",
          content: <OutgoingEmailEditor kind="invoice" />,
        },
        {
          key: "contracts",
          label: "Contracts",
          content: <OutgoingEmailEditor kind="contract" />,
        },
        {
          key: "payment-links",
          label: "Payment links",
          content: <OutgoingEmailEditor kind="payment-link" />,
        },
      ]}
    />
  );
}
