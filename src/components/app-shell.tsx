"use client";

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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const isAuthPage = AUTH_ROUTES.some((r) => pathname.startsWith(r));
  const isPublicPage = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isInternalFullscreen = INTERNAL_FULLSCREEN_PATTERNS.some((re) => re.test(pathname));
  const isFullBleed = FULL_BLEED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );

  if (isAuthPage || isPublicPage || isInternalFullscreen) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main
        className={cn(
          "pt-[calc(env(safe-area-inset-top)+3.5rem)] lg:pt-0 min-h-screen transition-[margin] duration-200 ease-out",
          collapsed ? "lg:ml-16" : "lg:ml-52",
        )}
      >
        {isFullBleed ? children : <div className="p-6 lg:p-8">{children}</div>}
      </main>
    </>
  );
}
