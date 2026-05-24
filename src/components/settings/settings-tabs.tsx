"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SettingsTabsTab {
  key: string;
  label: string;
  content: React.ReactNode;
}

export interface SettingsTabsProps {
  tabs: SettingsTabsTab[];
  defaultTab?: string;
}

export function SettingsTabs({ tabs, defaultTab }: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const urlKey = searchParams.get("tab");
  const known = tabs.some((t) => t.key === urlKey);
  const activeKey =
    (known ? urlKey : null) ?? defaultTab ?? tabs[0]?.key ?? "";

  function handleChange(next: unknown) {
    if (typeof next !== "string" || next === activeKey) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeKey} onValueChange={handleChange}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
