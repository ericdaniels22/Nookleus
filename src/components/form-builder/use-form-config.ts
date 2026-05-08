"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FormConfig } from "@/lib/types";

export type SaveStatus =
  | { kind: "idle"; version: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function useFormConfig() {
  const [config, setConfig] = useState<FormConfig>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle", version: 0 });

  const lastSavedRef = useRef<string>("");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/settings/intake-form");
      if (!res.ok) {
        if (!cancelled) {
          setLoading(false);
          toast.error("Failed to load form config");
        }
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      const initial: FormConfig = data.config?.sections
        ? data.config
        : { sections: [] };
      setConfig(initial);
      lastSavedRef.current = JSON.stringify(initial);
      setStatus({ kind: "idle", version: data.version ?? 0 });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: FormConfig) => {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/settings/intake-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      lastSavedRef.current = JSON.stringify(next);
      setStatus({ kind: "idle", version: data.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setStatus({ kind: "error", message });
      toast.error(`Save failed: ${message}`);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    const serialized = JSON.stringify(config);
    if (serialized === lastSavedRef.current) {
      return;
    }
    setStatus({ kind: "dirty" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      save(config);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [config, loading, save]);

  const saveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    return save(config);
  }, [config, save]);

  return { config, setConfig, loading, status, saveNow };
}
