"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { migrateUnencryptedFiles } from "./crypto-vault";
import { BackgroundSyncRunner } from "./background-sync";
import { NetworkMonitor } from "./network-monitor";
import { UploadQueueWorker, type QueueCounts } from "./upload-queue";
import type { CaptureSidecar } from "./capture-types";

interface Ctx {
  counts: QueueCounts;
  list: CaptureSidecar[];
  retry: (captureId: string) => Promise<void>;
  deleteFromQueue: (captureId: string) => Promise<void>;
}

const UploadQueueContext = createContext<Ctx | null>(null);

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<QueueCounts>({
    pending: 0, uploading: 0, failed: 0, synced: 0,
  });
  const [list, setList] = useState<CaptureSidecar[]>([]);
  const workerRef = useRef<UploadQueueWorker | null>(null);
  const networkRef = useRef<NetworkMonitor | null>(null);
  const bgSyncRef = useRef<BackgroundSyncRunner | null>(null);
  const captureListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let appStateHandle: { remove: () => Promise<void> } | null = null;

    (async () => {
      const supabase = createClient();
      const orgId = await getActiveOrganizationId(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !orgId) return;
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const takenBy = profile?.full_name || user.email || "unknown";

      await migrateUnencryptedFiles().catch((e) =>
        console.warn("[65c] migration failed (non-fatal)", e),
      );

      const onChange = () => {
        if (cancelled || !workerRef.current) return;
        setCounts(workerRef.current.counts());
        setList(workerRef.current.list());
      };

      const worker = new UploadQueueWorker({
        supabase,
        organizationId: orgId,
        takenBy,
        onChange,
      });
      workerRef.current = worker;

      await worker.scanAll();
      onChange();
      worker.drain();

      const network = new NetworkMonitor();
      await network.start(() => worker.drain());
      networkRef.current = network;

      const bgSync = new BackgroundSyncRunner();
      await bgSync.start((budgetMs) => worker.drain({ budgetMs }));
      bgSyncRef.current = bgSync;

      appStateHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) worker.drain();
      });

      const onCaptureWritten = () => {
        void worker.scanAll().then(() => worker.drain());
      };
      window.addEventListener("65c-capture-written", onCaptureWritten);
      captureListenerRef.current = onCaptureWritten;
    })();

    return () => {
      cancelled = true;
      networkRef.current?.stop();
      bgSyncRef.current?.stop();
      appStateHandle?.remove();
      if (captureListenerRef.current) {
        window.removeEventListener(
          "65c-capture-written",
          captureListenerRef.current,
        );
        captureListenerRef.current = null;
      }
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      counts,
      list,
      retry: async (id) => { await workerRef.current?.retry(id); },
      deleteFromQueue: async (id) => { await workerRef.current?.deleteFromQueue(id); },
    }),
    [counts, list],
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): Ctx {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueue must be used within UploadQueueProvider");
  return ctx;
}
