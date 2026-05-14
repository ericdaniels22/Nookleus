"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { TemplateRef } from "@/lib/contracts/template-reference-lookup";

type UsageMap = Record<string, TemplateRef[]>;

interface UsageContextValue {
  usage: UsageMap;
  loading: boolean;
  refetch: () => Promise<void>;
}

const UsageContext = createContext<UsageContextValue | null>(null);

export function UsageProvider({ children }: { children: React.ReactNode }) {
  const [usage, setUsage] = useState<UsageMap>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/intake-form/usage");
      if (!res.ok) {
        setUsage({});
        return;
      }
      const data = await res.json();
      setUsage(data.usage ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <UsageContext.Provider value={{ usage, loading, refetch }}>
      {children}
    </UsageContext.Provider>
  );
}

export function useFieldUsage(slug: string): TemplateRef[] {
  const ctx = useContext(UsageContext);
  if (!ctx) return [];
  return ctx.usage[slug] ?? [];
}

export function useUsageRefetch(): () => Promise<void> {
  const ctx = useContext(UsageContext);
  return ctx?.refetch ?? (async () => {});
}
