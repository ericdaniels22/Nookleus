"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/nav";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { OnTheClockProvider } from "@/lib/on-the-clock-context";
import OnTheClockBar from "@/components/time/on-the-clock-bar";
import AwayNudgeWatcher from "@/components/time/away-nudge-watcher";
import { cn } from "@/lib/utils";

const AUTH_ROUTES = ["/login", "/logout", "/set-password"];
const FULL_BLEED_ROUTES = ["/email"];
// Viewport-owning canvas surfaces also render full-bleed: the §4 content box
// is auto-height, so a surface that sizes itself with percentage heights
// collapses inside it (#859 — the sketch canvas body measured 0px and no Room
// could be drawn). Patterns, because these routes nest under a Job id. A
// full-bleed surface claims its own viewport height (see email-inbox /
// plan-editor roots).
const FULL_BLEED_PATTERNS: RegExp[] = [/^\/jobs\/[^/]+\/sketch(\/|$)/];
// Public customer-facing routes render without the internal app chrome. The
// marketing landing (/welcome) and legal pages (/privacy, /terms) are public
// too — they must be reachable, and render bare, for Google's OAuth app
// verification (#789), where reviewers visit them without a Nookleus session.
const PUBLIC_ROUTES = ["/sign", "/pay", "/welcome", "/privacy", "/terms"];
// Internal routes that still require auth (handled in the page itself)
// but render full-screen without the sidebar — used for the tablet
// in-person signing handoff where the iPad is given to the customer.
const INTERNAL_FULLSCREEN_PATTERNS: RegExp[] = [
  /^\/contracts\/[^/]+\/sign-in-person(\/|$)/,
  /^\/jobs\/[^/]+\/capture(\/|$)/,
];
// Builder routes render the side navbar as a slim icon rail so the document
// gets full content width (#543). Covers the estimate, invoice, and template
// editing modes — all served by EstimateBuilder — plus the in-Job Photo Report
// builder (#548), which used to be full-screen and now keeps the nav so the
// author is never trapped, the in-Job Showcase builder (#613), which has the
// same full-page editor shape, and the in-Job Sketch builder (#860),
// the full-screen multi-room plan editor served by PlanEditor (#890).
const BUILDER_ROUTE_PATTERNS: RegExp[] = [
  /^\/estimates\/[^/]+\/edit(\/|$)/,
  /^\/invoices\/[^/]+\/edit(\/|$)/,
  /^\/settings\/estimate-templates\/[^/]+\/edit(\/|$)/,
  /^\/jobs\/[^/]+\/reports\/[^/]+(\/|$)/,
  /^\/jobs\/[^/]+\/showcases\/[^/]+(\/|$)/,
  /^\/jobs\/[^/]+\/sketch(\/|$)/,
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
  const isFullBleed =
    FULL_BLEED_ROUTES.some(
      (r) => pathname === r || pathname.startsWith(`${r}/`),
    ) || FULL_BLEED_PATTERNS.some((re) => re.test(pathname));

  if (isAuthPage || isPublicPage || isInternalFullscreen) {
    return <>{children}</>;
  }

  // On a builder route the content sits beside the slim rail (or the expanded
  // navbar when the rail is open); elsewhere it follows the persisted pref.
  const effectiveCollapsed = isBuilderRoute ? !railExpanded : collapsed;

  // The On-the-clock state + persistent status bar live inside the app chrome
  // (issue #701) — never on the auth / public / fullscreen routes handled by
  // the early return above, so the bar can't surface on the login screen or the
  // customer-facing handoff surfaces.
  return (
    <OnTheClockProvider>
      <Sidebar
        forceCollapsed={isBuilderRoute ? !railExpanded : undefined}
        onToggleRail={
          isBuilderRoute ? () => setRailExpanded((v) => !v) : undefined
        }
      />
      {/* Responsive bands (design-system §7.1): drawer below md (the fixed
          mobile topbar offsets via padding), 56px icon rail from md, full
          240px sidebar from lg. Collapsed keeps the rail at every band. */}
      <main
        className={cn(
          "pt-[calc(env(safe-area-inset-top)+3.5rem)] md:pt-0 min-h-dvh transition-[margin] duration-200 ease-out",
          effectiveCollapsed ? "md:ml-14" : "md:ml-14 lg:ml-60",
        )}
      >
        {isFullBleed ? (
          children
        ) : (
          // §4: content max-width 1440px, fluid below; page padding 16px on
          // phone stepping to 24/32px.
          <div className="mx-auto max-w-[1440px] p-4 md:p-6 lg:p-8">
            {children}
          </div>
        )}
      </main>
      <OnTheClockBar />
      <AwayNudgeWatcher />
    </OnTheClockProvider>
  );
}
