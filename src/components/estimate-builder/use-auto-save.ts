"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AutoSaveConfig } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2000;
const SAVED_DURATION_MS = 3000;
const MAX_BACKOFF_MS = 30_000;
// A hung fetch must not stick saveStatus in "saving" forever: every save wraps its
// fetch in an AbortController that aborts after FETCH_TIMEOUT_MS, and the resulting
// AbortError is handled as an ordinary retryable error (exp-backoff), not a dead
// end. Paired with the per-line-item in-flight guard (inFlightItemsRef) so two
// debounced saves of the same item can't race.
const FETCH_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ReorderedSection {
  id: string;
  sort_order: number;
  parent_section_id: string | null;
}

export interface ReorderedLineItem {
  id: string;
  section_id: string;
  sort_order: number;
}

export interface UseAutoSaveResult {
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  saveSectionsReorder: (sections: ReorderedSection[]) => Promise<boolean>;
  saveLineItemsReorder: (items: ReorderedLineItem[]) => Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saveable field subsets — line-item subset stays internal; shared across
// estimate and invoice (same field names). Template per-line-item save is
// gated off via entityKind so LineItemSubset never needs template item fields.
// ─────────────────────────────────────────────────────────────────────────────

const LINE_ITEM_FIELDS = [
  "description",
  "note",
  "code",
  "quantity",
  "unit",
  "unit_price",
  "section_id",
  "sort_order",
] as const;

type LineItemFieldKey = typeof LINE_ITEM_FIELDS[number];
type LineItemSubset = Record<LineItemFieldKey, unknown>;

// Minimal internal shape used for sections traversal — all three entity kinds
// (EstimateWithContents, InvoiceWithContents, TemplateWithContents) share this
// nested structure at runtime even though TypeScript sees different types.
interface SectionLike {
  items: Array<{ id: string } & Record<string, unknown>>;
  subsections: Array<{
    items: Array<{ id: string } & Record<string, unknown>>;
  }>;
}

interface EntityWithSections {
  sections: SectionLike[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function pickLineItemFields(item: { id: string } & Record<string, unknown>): LineItemSubset {
  const result = {} as LineItemSubset;
  for (const k of LINE_ITEM_FIELDS) {
    result[k] = item[k];
  }
  return result;
}

function collectLineItems(entity: EntityWithSections): Map<string, LineItemSubset> {
  const map = new Map<string, LineItemSubset>();
  for (const sec of entity.sections) {
    for (const item of sec.items) {
      map.set(item.id, pickLineItemFields(item));
    }
    for (const sub of sec.subsections) {
      for (const item of sub.items) {
        map.set(item.id, pickLineItemFields(item));
      }
    }
  }
  return map;
}

function getAllLineItems(entity: EntityWithSections): Array<{ id: string } & Record<string, unknown>> {
  const items: Array<{ id: string } & Record<string, unknown>> = [];
  for (const sec of entity.sections) {
    items.push(...sec.items);
    for (const sub of sec.subsections) {
      items.push(...sub.items);
    }
  }
  return items;
}

/** Returns true if two subsets differ (shallow compare on field values). */
function diffSubset<T extends Record<string, unknown>>(a: T, b: T): boolean {
  for (const k in a) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// useAutoSave
// ─────────────────────────────────────────────────────────────────────────────

export function useAutoSave<T extends { id: string; updated_at?: string | null }>(
  config: AutoSaveConfig<T>,
  state: { entity: T; setEntity: (e: T) => void },
): UseAutoSaveResult {
  const { entity } = state;

  // ── Snapshots of last successfully-saved data ─────────────────────────────
  const lastSavedSnapshotRef = useRef<unknown | null>(null);
  const lastSavedLineItemsRef = useRef<Map<string, LineItemSubset>>(new Map());
  // The updated_at value from the server (sent as updated_at_snapshot for 409 guard).
  const updatedAtRef = useRef<string>(entity.updated_at ?? "");

  // ── State machine ─────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // ── Timers + in-flight guards ─────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineItemTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const sectionsReorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineItemsReorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffMsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const inFlightItemsRef = useRef<Set<string>>(new Set());
  const staleConflictRef = useRef<boolean>(false);

  // ── Mount: initialize snapshots ────────────────────────────────────────────
  useEffect(() => {
    if (lastSavedSnapshotRef.current === null) {
      lastSavedSnapshotRef.current = config.serializeRootPut(entity);
      if (config.entityKind !== "template") {
        lastSavedLineItemsRef.current = collectLineItems(
          entity as unknown as EntityWithSections,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Re-baseline on external entity refresh (the "two halves" re-sync) ─────
  // The snapshot baselines (updatedAtRef, lastSavedSnapshotRef,
  // lastSavedLineItemsRef) are set once on mount. But a server-driven mutation
  // OUTSIDE the autosave PUT path — a status transition (Mark Paid/Sent/Void),
  // apply-template, etc. — bumps the row's updated_at server-side, and the parent
  // then re-syncs the entity prop via router.refresh(). Without this effect the
  // baselines stay frozen at mount-time values, the next autosave PUT sends a stale
  // updated_at_snapshot, 409s, and the user is stuck in a "Modified by another
  // user" stale-conflict toast LOOP. So when entity.updated_at advances we
  // re-baseline all three refs to match (this runs before the watch effect's
  // debounced timer fires) and dismiss any stuck stale-conflict toast.
  //
  // CRITICAL: skip the re-baseline while a save is in flight. That in-flight save
  // picks up the new updated_at from its OWN response; re-baselining mid-flight
  // would clobber that response's token and re-trigger the 409 loop. This is the
  // inner-hook half of the fix; the parent-state-sync half (useEffect + setState in
  // the builder shell) is the other half — both halves are required.
  useEffect(() => {
    if (lastSavedSnapshotRef.current === null) return; // not yet initialized
    if (!entity.updated_at) return;
    if (entity.updated_at === updatedAtRef.current) return;
    if (inFlightRef.current || inFlightItemsRef.current.size > 0) return;

    updatedAtRef.current = entity.updated_at;
    lastSavedSnapshotRef.current = config.serializeRootPut(entity);
    if (config.entityKind !== "template") {
      lastSavedLineItemsRef.current = collectLineItems(
        entity as unknown as EntityWithSections,
      );
    }
    if (staleConflictRef.current) {
      staleConflictRef.current = false;
      toast.dismiss("stale-conflict");
      setSaveStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.updated_at]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (sectionsReorderTimerRef.current) clearTimeout(sectionsReorderTimerRef.current);
      if (lineItemsReorderTimerRef.current) clearTimeout(lineItemsReorderTimerRef.current);
      for (const t of lineItemTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  // ── Core save flow helpers ────────────────────────────────────────────────

  const transitionToSaved = useCallback(() => {
    setSaveStatus("saved");
    setLastSavedAt(new Date());
    backoffMsRef.current = 0;
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      setSaveStatus("idle");
    }, SAVED_DURATION_MS);
  }, []);

  /** Handles a 409 stale-conflict response. */
  const handleStaleConflict = useCallback(() => {
    staleConflictRef.current = true;
    setSaveStatus("error");
    toast.error("Modified by another user — refresh to see changes", {
      duration: Infinity,
      id: "stale-conflict",
    });
  }, []);

  /** Handles a 5xx / network error — sets error state and schedules retry on the given timer ref. */
  const handleSaveError = useCallback(
    (
      timerRef: { current: ReturnType<typeof setTimeout> | null },
      retryFn: () => void,
    ) => {
      setSaveStatus("error");
      const delay = backoffMsRef.current === 0 ? 1000 : Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
      backoffMsRef.current = delay;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(retryFn, delay);
    },
    [],
  );

  // ── Entity-level auto-save ────────────────────────────────────────────────

  const performEntitySave = useCallback(async () => {
    if (staleConflictRef.current) return;
    if (lastSavedSnapshotRef.current === null) return;

    const current = config.serializeRootPut(entity);
    if (!diffSubset(
      current as Record<string, unknown>,
      lastSavedSnapshotRef.current as Record<string, unknown>,
    )) {
      // No changes — stay idle (or go back to idle if we were in error from a prior run)
      return;
    }

    if (inFlightRef.current) {
      // Re-schedule: another save is in flight, check again after it finishes
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(performEntitySave, DEBOUNCE_MS);
      return;
    }

    inFlightRef.current = true;
    setSaveStatus("saving");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const body = config.hasSnapshotConcurrency
        ? { ...(current as object), updated_at_snapshot: updatedAtRef.current }
        : current;

      const res = await fetch(config.paths.rootPut, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as { estimate?: T; invoice?: T; template?: T; updated_at?: string | null };
        // Extract the returned entity from the response (shape varies by kind)
        const returned =
          (data as Record<string, unknown>)[config.entityKind] as T | undefined;
        if (returned) {
          lastSavedSnapshotRef.current = config.serializeRootPut(returned);
          if (returned.updated_at) {
            updatedAtRef.current = returned.updated_at;
          }
        } else {
          // Some routes return just updated_at instead of the full entity
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          lastSavedSnapshotRef.current = current;
        }
        transitionToSaved();
      } else if (res.status === 409 && config.hasSnapshotConcurrency) {
        handleStaleConflict();
      } else if (res.status === 404) {
        // Document was trashed (or hard-deleted) under us — terminal stop.
        handleStaleConflict();
      } else if (res.status === 409 && !config.hasSnapshotConcurrency) {
        // Templates have no snapshot concurrency — treat 409 as a generic error
        handleSaveError(saveTimerRef, performEntitySave);
      } else {
        // 4xx other than 409/404: treat as error too
        handleSaveError(saveTimerRef, performEntitySave);
      }
    } catch (err) {
      // AbortError (timeout) is treated the same as a network error
      if (err instanceof Error && err.name === "AbortError") {
        handleSaveError(saveTimerRef, performEntitySave);
      } else {
        handleSaveError(saveTimerRef, performEntitySave);
      }
    } finally {
      clearTimeout(timeoutId);
      inFlightRef.current = false;

      // After in-flight completes, check if there are still unsaved changes
      if (!staleConflictRef.current && lastSavedSnapshotRef.current !== null) {
        const after = config.serializeRootPut(entity);
        if (diffSubset(
          after as Record<string, unknown>,
          lastSavedSnapshotRef.current as Record<string, unknown>,
        )) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(performEntitySave, DEBOUNCE_MS);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, config, transitionToSaved, handleStaleConflict, handleSaveError]);

  // ── Watch entity-level fields, schedule debounced save ─────────────────
  useEffect(() => {
    if (staleConflictRef.current) return;
    if (lastSavedSnapshotRef.current === null) return; // not yet initialized

    const current = config.serializeRootPut(entity);
    if (!diffSubset(
      current as Record<string, unknown>,
      lastSavedSnapshotRef.current as Record<string, unknown>,
    )) return; // no change

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(performEntitySave, DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // We use entity as a whole so that any field change triggers re-check.
  // The serializer picks only the relevant fields for the diff.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, performEntitySave]);

  // ── Per-line-item auto-save ───────────────────────────────────────────────
  // Gated: templates do not use per-line-item saves (no live DB rows backing
  // template line items until a future task implements the draft-estimate pattern).

  const performLineItemSave = useCallback(
    async (item: { id: string } & Record<string, unknown>) => {
      if (staleConflictRef.current) return;

      const savedSubset = lastSavedLineItemsRef.current.get(item.id);
      const currentSubset = pickLineItemFields(item);

      if (savedSubset && !diffSubset(currentSubset, savedSubset)) return; // no change

      // C2: per-item in-flight guard — if already saving this item, early-return;
      // the watch effect will re-pick it up on the next render (still-dirty).
      if (inFlightItemsRef.current.has(item.id)) return;

      // I1: schedule a retry of this item via lineItemTimersRef. Re-typing the
      // same item clears this timer in the watch effect, replacing it with a
      // fresh debounce that reads the latest state.
      const scheduleLineItemRetry = () => {
        const delay = backoffMsRef.current === 0 ? 1000 : Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
        backoffMsRef.current = delay;
        const existing = lineItemTimersRef.current.get(item.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => void performLineItemSave(item), delay);
        lineItemTimersRef.current.set(item.id, timer);
      };

      inFlightItemsRef.current.add(item.id);
      setSaveStatus("saving");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const lineItemBody = config.hasSnapshotConcurrency
          ? { ...currentSubset, updated_at_snapshot: updatedAtRef.current }
          : currentSubset;

        const res = await fetch(
          config.paths.lineItemRoute(item.id),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(lineItemBody),
            signal: controller.signal,
          }
        );

        if (res.ok) {
          const data = (await res.json()) as { line_item?: unknown; updated_at?: string | null };
          lastSavedLineItemsRef.current.set(item.id, currentSubset);
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
        } else if (res.status === 409 || res.status === 404) {
          // I3: 404 (item gone — likely deleted by another user) is also a stale signal.
          handleStaleConflict();
        } else {
          // 5xx / other 4xx — schedule retry with exp backoff.
          setSaveStatus("error");
          scheduleLineItemRetry();
        }
      } catch (err) {
        // AbortError (timeout) and network errors — schedule retry.
        setSaveStatus("error");
        scheduleLineItemRetry();
        // Reference err to keep the catch typed without an unused-var warning.
        void err;
      } finally {
        clearTimeout(timeoutId);
        inFlightItemsRef.current.delete(item.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, transitionToSaved, handleStaleConflict]
  );

  // Watch line-item changes — debounce per item (estimates + invoices only)
  useEffect(() => {
    if (config.entityKind === "template") return; // templates: no per-line-item save
    if (staleConflictRef.current) return;

    const entityWithSections = entity as unknown as EntityWithSections;
    const allItems = getAllLineItems(entityWithSections);
    for (const item of allItems) {
      const saved = lastSavedLineItemsRef.current.get(item.id);
      if (!saved) {
        // New item (just added by server round-trip) — record it without saving
        lastSavedLineItemsRef.current.set(item.id, pickLineItemFields(item));
        continue;
      }
      const current = pickLineItemFields(item);
      if (!diffSubset(current, saved)) continue; // unchanged

      // Changed — schedule debounced save
      const existing = lineItemTimersRef.current.get(item.id);
      if (existing) clearTimeout(existing);

      // Capture the item snapshot at scheduling time so closure captures correct value
      const capturedItem = item;
      const timer = setTimeout(() => {
        void performLineItemSave(capturedItem);
      }, DEBOUNCE_MS);
      lineItemTimersRef.current.set(item.id, timer);
    }
  // We intentionally use the raw entity to detect item changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, config.entityKind, performLineItemSave]);

  // ── Reorder save methods (called immediately from handleDragEnd) ──────────

  const saveSectionsReorder = useCallback(
    async (sections: ReorderedSection[]): Promise<boolean> => {
      if (staleConflictRef.current) return false;

      // A new reorder supersedes any pending retry — clear before issuing.
      if (sectionsReorderTimerRef.current) {
        clearTimeout(sectionsReorderTimerRef.current);
        sectionsReorderTimerRef.current = null;
      }

      setSaveStatus("saving");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const reorderBody = config.hasSnapshotConcurrency
          ? { sections, updated_at_snapshot: updatedAtRef.current }
          : { sections };

        const res = await fetch(config.paths.sectionsReorder, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reorderBody),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: true; updated_at?: string | null };
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
          return true;
        } else if (res.status === 409 || res.status === 404) {
          // I3: 404 (a section we're reordering is gone) is treated as stale.
          if (config.hasSnapshotConcurrency) {
            handleStaleConflict();
          } else {
            handleSaveError(sectionsReorderTimerRef, () => void saveSectionsReorder(sections));
          }
          return false;
        } else {
          // I1: retry with the same payload after exp backoff.
          handleSaveError(sectionsReorderTimerRef, () => void saveSectionsReorder(sections));
          return false;
        }
      } catch (err) {
        // AbortError (timeout) and network errors — retry with same payload.
        handleSaveError(sectionsReorderTimerRef, () => void saveSectionsReorder(sections));
        void err;
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, transitionToSaved, handleStaleConflict, handleSaveError]
  );

  const saveLineItemsReorder = useCallback(
    async (items: ReorderedLineItem[]): Promise<boolean> => {
      if (staleConflictRef.current) return false;

      if (lineItemsReorderTimerRef.current) {
        clearTimeout(lineItemsReorderTimerRef.current);
        lineItemsReorderTimerRef.current = null;
      }

      setSaveStatus("saving");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const reorderBody = config.hasSnapshotConcurrency
          ? { items, updated_at_snapshot: updatedAtRef.current }
          : { items };

        const res = await fetch(config.paths.lineItemsReorder, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reorderBody),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: true; updated_at?: string | null };
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
          return true;
        } else if (res.status === 409 || res.status === 404) {
          if (config.hasSnapshotConcurrency) {
            handleStaleConflict();
          } else {
            handleSaveError(lineItemsReorderTimerRef, () => void saveLineItemsReorder(items));
          }
          return false;
        } else {
          handleSaveError(lineItemsReorderTimerRef, () => void saveLineItemsReorder(items));
          return false;
        }
      } catch (err) {
        handleSaveError(lineItemsReorderTimerRef, () => void saveLineItemsReorder(items));
        void err;
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, transitionToSaved, handleStaleConflict, handleSaveError]
  );

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    saveStatus,
    lastSavedAt,
    saveSectionsReorder,
    saveLineItemsReorder,
  };
}
