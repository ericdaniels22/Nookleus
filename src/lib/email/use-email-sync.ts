"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Account {
  id: string;
  last_synced_at: string | null;
}

export interface UseEmailSyncInput {
  accounts: Account[];
  selectedAccountId: string | null;
  doSync: () => Promise<void>;
  debounceMs?: number;
  autoSync?: boolean;
}

export interface UseEmailSyncReturn {
  syncing: boolean;
  lastSyncedAt: Date | null;
  syncFailed: boolean;
  syncSilent: () => Promise<void>;
  syncVisible: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 60_000;

function pickScopeLatest(
  accounts: Account[],
  selectedAccountId: string | null,
): Date | null {
  const inScope = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;
  let best: Date | null = null;
  for (const a of inScope) {
    if (!a.last_synced_at) continue;
    const d = new Date(a.last_synced_at);
    if (!best || d > best) best = d;
  }
  return best;
}

export function useEmailSync(input: UseEmailSyncInput): UseEmailSyncReturn {
  const debounceMs = input.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const autoSync = input.autoSync ?? true;
  const inFlight = useRef<Promise<void> | null>(null);
  const doSyncRef = useRef(input.doSync);
  doSyncRef.current = input.doSync;

  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() =>
    pickScopeLatest(input.accounts, input.selectedAccountId),
  );
  const [syncFailed, setSyncFailed] = useState(false);

  const startSync = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const p = doSyncRef.current();
    inFlight.current = p;
    // .then(h, h) instead of .finally(h): a .finally chain returns a new
    // promise that re-rejects with the same reason, which becomes an
    // unhandled rejection if no one awaits it. Two-arg .then absorbs the
    // rejection so only the original p propagates to callers via await.
    const clear = () => {
      if (inFlight.current === p) inFlight.current = null;
    };
    p.then(clear, clear);
    return p;
  }, []);

  const syncSilent = useCallback(async () => {
    try {
      await startSync();
      setSyncFailed(false);
      setLastSyncedAt(new Date());
    } catch {
      setSyncFailed(true);
    }
  }, [startSync]);

  const syncVisible = useCallback(async () => {
    setSyncing(true);
    try {
      await startSync();
      setSyncFailed(false);
      setLastSyncedAt(new Date());
    } catch (err) {
      setSyncFailed(true);
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [startSync]);

  useEffect(() => {
    if (!autoSync) return;
    const latest = pickScopeLatest(input.accounts, input.selectedAccountId);
    const expired =
      latest === null || Date.now() - latest.getTime() > debounceMs;
    if (!expired) return;
    void syncSilent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    syncing,
    lastSyncedAt,
    syncFailed,
    syncSilent,
    syncVisible,
  };
}
