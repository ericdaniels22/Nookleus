"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";
import type { JobStatus, DamageType } from "@/lib/types";
import { JOB_STATUS_PRESENTATION } from "@/lib/job-status-presentation";

// Fallback defaults used before DB data loads. Derived from the single
// code-side source of truth (issue #720) so the pre-load labels/colors —
// Lead / Active / Collections / Closed / Lost — can never drift from the
// presentation module or the relabel migration.
const DEFAULT_STATUS_COLORS: Record<string, { bg: string; text: string }> =
  Object.fromEntries(
    Object.values(JOB_STATUS_PRESENTATION).map((p) => [p.key, p.badge]),
  );

const DEFAULT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(JOB_STATUS_PRESENTATION).map((p) => [p.key, p.label]),
);

const DEFAULT_DAMAGE_COLORS: Record<string, { bg: string; text: string }> = {
  water: { bg: "#E6F1FB", text: "#0C447C" },
  fire: { bg: "#FAECE7", text: "#712B13" },
  mold: { bg: "#EAF3DE", text: "#27500A" },
  storm: { bg: "#EEEDFE", text: "#3C3489" },
  biohazard: { bg: "#FCEBEB", text: "#791F1F" },
  contents: { bg: "#FFF8E6", text: "#7A5E00" },
  rebuild: { bg: "#F1EFE8", text: "#5F5E5A" },
  other: { bg: "#F1EFE8", text: "#5F5E5A" },
};

const DEFAULT_DAMAGE_LABELS: Record<string, string> = {
  water: "Water",
  fire: "Fire",
  mold: "Mold",
  storm: "Storm",
  biohazard: "Biohazard",
  contents: "Contents",
  rebuild: "Rebuild",
  other: "Other",
};

interface ConfigContextType {
  statuses: JobStatus[];
  damageTypes: DamageType[];
  loading: boolean;
  refresh: () => Promise<void>;
  getStatusColor: (name: string) => string;
  getStatusLabel: (name: string) => string;
  getDamageTypeColor: (name: string) => string;
  getDamageTypeLabel: (name: string) => string;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [statusRes, damageRes] = await Promise.all([
      supabase.from("job_statuses").select("*").order("sort_order"),
      supabase.from("damage_types").select("*").order("sort_order"),
    ]);
    if (statusRes.data) setStatuses(statusRes.data as JobStatus[]);
    if (damageRes.data) setDamageTypes(damageRes.data as DamageType[]);
    setLoading(false);
  }, []);

  // Plan §5.4 fix (approach a): wait for the auth state to be known before
  // fetching. Pre-build57, the auth race was hidden by `Allow all on
  // damage_types` legacy policies (anon could read). Post-build57,
  // damage_types/job_statuses RLS is {authenticated}-only, so an anon
  // fetch (which is what we'd get from a cold-incognito mount before the
  // session cookie hydrates) returns zero rows and ConfigProvider would
  // never re-fetch.
  //
  // The fix: subscribe to onAuthStateChange. INITIAL_SESSION fires once on
  // mount with the resolved session (or null). SIGNED_IN / TOKEN_REFRESHED
  // also trigger a refresh — TOKEN_REFRESHED specifically catches the
  // workspace-switcher case where the active org changes (per-org
  // damage_types / job_statuses overrides may differ).
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED"
        ) {
          if (session) {
            refresh();
          } else {
            // No session — keep arrays empty but stop the spinner so the
            // login redirect (handled by AuthProvider / route guards) can
            // render without a blocking config load.
            setStatuses([]);
            setDamageTypes([]);
            setLoading(false);
          }
        } else if (event === "SIGNED_OUT") {
          setStatuses([]);
          setDamageTypes([]);
          setLoading(false);
        }
      },
    );
    return () => subscription.unsubscribe();
  }, [refresh]);

  function getStatusColor(name: string): string {
    const s = statuses.find((st) => st.name === name);
    if (s) return `bg-[${s.bg_color}] text-[${s.text_color}] ring-1 ring-[${s.text_color}]/20`;
    const d = DEFAULT_STATUS_COLORS[name];
    if (d) return `bg-[${d.bg}] text-[${d.text}] ring-1 ring-[${d.text}]/20`;
    return "bg-muted text-muted-foreground ring-1 ring-border";
  }

  function getStatusLabel(name: string): string {
    const s = statuses.find((st) => st.name === name);
    if (s) return s.display_label;
    return DEFAULT_STATUS_LABELS[name] || name;
  }

  function getDamageTypeColor(name: string): string {
    const dt = damageTypes.find((d) => d.name === name);
    if (dt) return `bg-[${dt.bg_color}] text-[${dt.text_color}] ring-1 ring-[${dt.text_color}]/20`;
    const d = DEFAULT_DAMAGE_COLORS[name];
    if (d) return `bg-[${d.bg}] text-[${d.text}] ring-1 ring-[${d.text}]/20`;
    return "bg-muted text-muted-foreground ring-1 ring-border";
  }

  function getDamageTypeLabel(name: string): string {
    const dt = damageTypes.find((d) => d.name === name);
    if (dt) return dt.display_label;
    return DEFAULT_DAMAGE_LABELS[name] || name;
  }

  return (
    <ConfigContext.Provider
      value={{
        statuses,
        damageTypes,
        loading,
        refresh,
        getStatusColor,
        getStatusLabel,
        getDamageTypeColor,
        getDamageTypeLabel,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used within ConfigProvider");
  }
  return ctx;
}
