"use client";

import { Suspense } from "react";
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

export function SettingsTabs(props: SettingsTabsProps) {
  // useSearchParams() opts the subtree out of prerendering; Suspense lets the
  // shell prerender statically and stream the URL-aware bits client-side.
  return (
    <Suspense fallback={<SettingsTabsView {...props} />}>
      <SettingsTabsInner {...props} />
    </Suspense>
  );
}

function SettingsTabsInner({ tabs, defaultTab }: SettingsTabsProps) {
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

  return <SettingsTabsView tabs={tabs} activeKey={activeKey} onValueChange={handleChange} />;
}

function SettingsTabsView({
  tabs,
  defaultTab,
  activeKey,
  onValueChange,
}: SettingsTabsProps & {
  activeKey?: string;
  onValueChange?: (next: unknown) => void;
}) {
  const value = activeKey ?? defaultTab ?? tabs[0]?.key ?? "";
  return (
    <Tabs value={value} onValueChange={onValueChange}>
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
