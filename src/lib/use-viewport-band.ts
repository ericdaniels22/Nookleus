"use client";

import { useSyncExternalStore } from "react";

/**
 * The three shell layout bands from design-system §7.1 (#912):
 *   phone   < 768px  — sidebar is a drawer behind the mobile topbar
 *   tablet  ≥ 768px  — sidebar is a 56px icon rail (iPad portrait)
 *   desktop ≥ 1024px — full 240px sidebar, persisted collapse pref applies
 *
 * Layout is keyed off viewport width only, never user-agent (§7.2 — an iPad
 * in 50% Split View must get the phone layout).
 */
export type ViewportBand = "phone" | "tablet" | "desktop";

const DESKTOP_QUERY = "(min-width: 1024px)";
const TABLET_QUERY = "(min-width: 768px)";

function getBand(): ViewportBand {
  // jsdom (and any environment without matchMedia) reports desktop so the
  // full sidebar renders by default in tests and during SSR.
  if (typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "phone";
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const lists = [
    window.matchMedia(DESKTOP_QUERY),
    window.matchMedia(TABLET_QUERY),
  ];
  lists.forEach((list) => list.addEventListener("change", onChange));
  return () =>
    lists.forEach((list) => list.removeEventListener("change", onChange));
}

export function useViewportBand(): ViewportBand {
  // Server snapshot is desktop; the client corrects to the real band right
  // after hydration without a mismatch warning.
  return useSyncExternalStore(subscribe, getBand, () => "desktop");
}
