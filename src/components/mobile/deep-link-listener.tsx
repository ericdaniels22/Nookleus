"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { parseDeepLink } from "@/lib/mobile/deep-link";

/**
 * Listens for Capacitor `appUrlOpen` events — fired when the app is opened
 * via a `nookleus://` deep link, e.g. a Quick Actions home-screen widget
 * button — and navigates to the matching in-app route. Renders nothing.
 *
 * Only the WidgetKit extension emits these links today; the parser ignores
 * anything that is not a recognized `nookleus://` action.
 */
export default function DeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handle = App.addListener("appUrlOpen", (event) => {
      const route = parseDeepLink(event.url);
      if (route) router.push(route);
    });

    return () => {
      handle.then((listener) => listener.remove());
    };
  }, [router]);

  return null;
}
