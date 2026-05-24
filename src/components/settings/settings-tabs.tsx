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

// The Tabs primitive needs the active tab key resolved on first render — we
// read it from `?tab=`, which means useSearchParams. Next 16 requires any
// useSearchParams caller to sit inside a Suspense boundary so the rest of
// the page can prerender statically; we wrap once here so every shell page
// gets the behavior for free.
export function SettingsTabs(props: SettingsTabsProps) {
  return (
    <Suspense fallback={<TabsFallback {...props} />}>
      <SettingsTabsInner {...props} />
    </Suspense>
  );
}

// The fallback is the same tab strip frozen on the static-default key, so
// users see the tab labels and the default body during hydration rather
// than a blank box.
function TabsFallback({ tabs, defaultTab }: SettingsTabsProps) {
  const activeKey = defaultTab ?? tabs[0]?.key ?? "";
  return (
    <Tabs value={activeKey}>
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
