"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";

/**
 * Registers this device with the new-intake push system. On app open (native
 * only) it asks for notification permission, registers with APNs, and POSTs the
 * resulting device token to `/api/push/register` so the device-address registry
 * (issue #671) knows where to buzz. Renders nothing.
 *
 * iOS delivers a rotated token through the same `'registration'` event, so the
 * listener re-POSTs on rotation for free — the registry upserts on the token,
 * refreshing the existing row. The POST is authenticated (`withRequestContext`);
 * a not-yet-logged-in caller 401s harmlessly and is picked up on the next open.
 * No push is SENT here — this slice only fills the registry. The permission
 * prompt and token round-trip are verified manually on TestFlight (no CI path).
 */
async function postDeviceToken(token: string): Promise<void> {
  try {
    await fetch("/api/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "ios" }),
    });
  } catch (err) {
    // Best-effort: a failed registration must never break app open.
    console.error("[push] register POST failed:", err);
  }
}

export default function PushRegistration() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const handles: Promise<PluginListenerHandle>[] = [];

    // The token arrives here on first registration AND on every later
    // rotation — POST it each time.
    handles.push(
      PushNotifications.addListener("registration", (token: Token) => {
        void postDeviceToken(token.value);
      }),
    );
    handles.push(
      PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] APNs registration error:", err.error);
      }),
    );

    void (async () => {
      let status = await PushNotifications.checkPermissions();
      if (
        status.receive === "prompt" ||
        status.receive === "prompt-with-rationale"
      ) {
        status = await PushNotifications.requestPermissions();
      }
      if (cancelled) return;
      if (status.receive === "granted") {
        // Triggers the 'registration' (or 'registrationError') listener above.
        await PushNotifications.register();
      }
    })().catch((err) => {
      console.error("[push] permission/register failed:", err);
    });

    return () => {
      cancelled = true;
      handles.forEach((h) => h.then((listener) => listener.remove()));
    };
  }, []);

  return null;
}
