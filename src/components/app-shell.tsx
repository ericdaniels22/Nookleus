"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/nav";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { cn } from "@/lib/utils";

const AUTH_ROUTES = ["/login", "/logout", "/set-password"];
const FULL_BLEED_ROUTES = ["/email"];
// Public customer-facing routes render without the internal app chrome.
const PUBLIC_ROUTES = ["/sign", "/pay"];
// Internal routes that still require auth (handled in the page itself)
// but render full-screen without the sidebar — used for the tablet
// in-person signing handoff where the iPad is given to the customer.
const INTERNAL_FULLSCREEN_PATTERNS: RegExp[] = [
  /^\/contracts\/[^/]+\/sign-in-person(\/|$)/,
  /^\/jobs\/[^/]+\/capture(\/|$)/,
  // The in-Job Photo Report builder (#400) is full-screen, like capture.
  /^\/jobs\/[^/]+\/reports\/[^/]+(\/|$)/,
];
// Estimate Builder routes (#543) render the side navbar as a slim icon rail so
// the document gets full content width. Covers the estimate, invoice, and
// template editing modes — all served by EstimateBuilder.
const BUILDER_ROUTE_PATTERNS: RegExp[] = [
  /^\/estimates\/[^/]+\/edit(\/|$)/,
  /^\/invoices\/[^/]+\/edit(\/|$)/,
  /^\/settings\/estimate-templates\/[^/]+\/edit(\/|$)/,
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  // Ephemeral rail state, scoped to this mount. Entering/leaving the builder
  // must NOT touch the persisted global "sidebar-collapsed" pref, so the rail
  // is driven by local state — never the persisting context toggle.
  const [railExpanded, setRailExpanded] = useState(false);
  const isAuthPage = AUTH_ROUTES.some((r) => pathname.startsWith(r));
  const isPublicPage = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isInternalFullscreen = INTERNAL_FULLSCREEN_PATTERNS.some((re) => re.test(pathname));
  const isBuilderRoute = BUILDER_ROUTE_PATTERNS.some((re) => re.test(pathname));
  const isFullBleed = FULL_BLEED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );

  if (isAuthPage || isPublicPage || isInternalFullscreen) {
    return <>{children}</>;
  }

  // On a builder route the content sits beside the slim rail (or the expanded
  // navbar when the rail is open); elsewhere it follows the persisted pref.
  const effectiveCollapsed = isBuilderRoute ? !railExpanded : collapsed;

  return (
    <>
      <Sidebar
        forceCollapsed={isBuilderRoute ? !railExpanded : undefined}
        onToggleRail={
          isBuilderRoute ? () => setRailExpanded((v) => !v) : undefined
        }
      />
      <main
        className={cn(
          "pt-[calc(env(safe-area-inset-top)+3.5rem)] lg:pt-0 min-h-screen transition-[margin] duration-200 ease-out",
          effectiveCollapsed ? "lg:ml-16" : "lg:ml-52",
        )}
      >
        {isFullBleed ? children : <div className="p-6 lg:p-8">{children}</div>}
      </main>
    </>
  );
}
