"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/notification-bell";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import { navGroups, settingsNavItem, type NavItem } from "@/lib/nav-items";
import { useNavOrder } from "@/lib/nav-order-context";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { useViewportBand } from "@/lib/use-viewport-band";
import { Tooltip } from "@base-ui/react/tooltip";

export default function Sidebar({
  forceCollapsed,
  onToggleRail,
}: {
  /** When set, overrides the persisted collapsed state for display — used by
   *  the builder's slim rail without touching the global preference. */
  forceCollapsed?: boolean;
  /** Click handler for the rail toggle while in the builder; when provided it
   *  replaces the persisted context toggle so no localStorage write happens. */
  onToggleRail?: () => void;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, hasPermission } = useAuth();
  const { order } = useNavOrder();
  const { collapsed: persistedCollapsed, toggle } = useSidebarCollapse();
  const band = useViewportBand();

  const [mobileOpen, setMobileOpen] = useState(false);
  // The labeled overlay serves the phone drawer AND the tablet rail's touch
  // expansion (§7.2 — no hover-only access). It never applies at desktop.
  const overlayOpen = mobileOpen && band !== "desktop";

  // Display mode (§7.1): the open overlay always shows the full labeled
  // sidebar; the builder's forceCollapsed override comes next; the tablet
  // band always rails; desktop follows the persisted pref.
  const collapsed = overlayOpen
    ? false
    : (forceCollapsed ?? (band === "tablet" ? true : persistedCollapsed));
  // In the builder the toggle is ephemeral (onToggleRail) so it never writes
  // the persisted "sidebar-collapsed" key. Everywhere else it falls back to the
  // persisting context toggle. At the tablet band the rail can't dock open
  // (§7.1 pins it at 56px), so expand/collapse drive the labeled overlay
  // instead — the touch equivalent required by §7.2.
  const handleExpand =
    band === "tablet" ? () => setMobileOpen(true) : (onToggleRail ?? toggle);
  const handleCollapse =
    band === "tablet" ? () => setMobileOpen(false) : (onToggleRail ?? toggle);

  // Filter each group by membership role + required permission, then sort
  // items WITHIN their group by DB sort_order (groups themselves are fixed by
  // design-system §5). Items missing from the DB fall to the bottom of their
  // group in code-defined order. An item with `requiredRoles` is hidden from
  // any caller whose role isn't in the list (e.g. crew_member never sees
  // Referral Partners). An item with `requiredPermission` is hidden from any
  // caller who lacks that grant (e.g. Phone is hidden from a crew_member
  // without view_phone — PRD #304 / #306). Groups left empty by filtering
  // drop out entirely, eyebrow included.
  const isVisible = (item: NavItem) => {
    if (item.requiredRoles) {
      if (!profile?.role || !item.requiredRoles.includes(profile.role)) {
        return false;
      }
    }
    if (item.requiredPermission && !hasPermission(item.requiredPermission)) {
      return false;
    }
    return true;
  };
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: [...group.items.filter(isVisible)].sort((a, b) => {
        const aOrder = order.get(a.href) ?? Infinity;
        const bOrder = order.get(b.href) ?? Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return group.items.indexOf(a) - group.items.indexOf(b);
      }),
    }))
    .filter((group) => group.items.length > 0);

  // Crossing into the desktop band closes any stale overlay so the body
  // scroll lock below releases (e.g. iPad rotating from portrait to
  // landscape with the drawer open).
  useEffect(() => {
    if (band === "desktop") setMobileOpen(false);
  }, [band]);

  // Hard body-scroll lock while the mobile overlay is open (issue #36).
  // `overflow: hidden` alone is a no-op in iOS WKWebView, so we use the
  // `position: fixed` + negative-top dance to lock the body element itself.
  // Capacitor's `contentInset: "automatic"` is bypassed while body is out
  // of normal flow, so the aside compensates with its own
  // `pt/pb-[env(safe-area-inset-*)]` (added below) — that way the sidebar
  // still renders below the iPhone status bar and above the home indicator.
  useEffect(() => {
    if (!mobileOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  // Active-workspace branding. RLS scopes /api/settings/company to the
  // active org, so this fetch returns whichever workspace the user is in.
  const [companyName, setCompanyName] = useState<string>("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setCompanyName("");
      setCompanyLogoUrl(null);
      return;
    }
    let cancelled = false;
    fetch("/api/settings/company")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { company_name?: string; logo_path?: string } | null) => {
        if (cancelled || !data) return;
        setCompanyName(data.company_name || "");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (data.logo_path && supabaseUrl) {
          setCompanyLogoUrl(
            `${supabaseUrl}/storage/v1/object/public/company-assets/${data.logo_path}`,
          );
        } else {
          setCompanyLogoUrl(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Email unread count for the §5 chip. The endpoint is view_email-gated —
  // a 403 (or any failure) just leaves the chip hidden.
  const [emailUnread, setEmailUnread] = useState(0);

  useEffect(() => {
    if (!profile) {
      setEmailUnread(0);
      return;
    }
    let cancelled = false;
    fetch("/api/email/counts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { inbox?: { unread?: number } } | null) => {
        if (cancelled || !data) return;
        setEmailUnread(data.inbox?.unread ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Count chips by nav href (§5) — only Email today, but the map keeps
  // renderNavLink item-agnostic.
  const countsByHref = new Map<string, number>([["/email", emailUnread]]);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  // One nav link, styled for the current display mode. Used by the grouped
  // list and the pinned Settings item so both stay in lockstep.
  function renderNavLink(item: NavItem) {
    const isActive =
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

    const linkClassName = cn(
      "rounded-lg text-sm font-medium transition-all duration-200",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-text-secondary hover:text-foreground hover:bg-muted",
      collapsed
        ? "flex items-center justify-center w-10 h-10 mx-auto"
        : "flex items-center gap-2.5 px-2.5 py-2",
    );

    const count = countsByHref.get(item.href) ?? 0;

    if (!collapsed) {
      // Expanded mode: no tooltip — the visible label is the accessible name.
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={linkClassName}
        >
          <item.icon size={18} />
          <span className="flex-1 truncate">{item.label}</span>
          {count > 0 && (
            // Count chip: same tint as the active item, pill, 11px (§5).
            <span className="shrink-0 rounded-full bg-sidebar-accent px-2 py-px text-[11px] font-medium tabular-nums text-sidebar-accent-foreground">
              {count}
            </span>
          )}
        </Link>
      );
    }

    // Collapsed mode: wrap the Link as a Tooltip.Trigger render target.
    return (
      <Tooltip.Root key={item.href}>
        <Tooltip.Trigger
          render={
            <Link
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-label={item.label}
              className={linkClassName}
            >
              <item.icon size={18} />
            </Link>
          }
        />
        <Tooltip.Portal>
          <Tooltip.Positioner side="right" sideOffset={8}>
            <Tooltip.Popup className="z-50 rounded-md bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-lg ring-1 ring-border">
              {item.label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  return (
    <>
      {/* Mobile top bar. Top padding includes the iOS safe-area inset so the
          bar's content sits below the notch / status bar on Capacitor. The
          rendered logo is sized to keep the bar's content area at h-14, which
          is what consumers (AppShell, email inbox) assume when computing
          their own offsets. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar border-b border-border-subtle px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {companyLogoUrl ? (
            <Image
              src={companyLogoUrl}
              alt={companyName || "Workspace"}
              width={120}
              height={44}
              className="h-9 w-auto"
              unoptimized
            />
          ) : (
            <span className="text-sm font-semibold text-foreground truncate max-w-[180px]">
              {companyName || ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            className="text-text-secondary hover:text-foreground transition-colors"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Overlay scrim — phone drawer and tablet rail expansion (§7.2). */}
      {overlayOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/85"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Tooltip.Provider delay={300}>
        <aside
          className={cn(
            "fixed top-0 left-0 z-40 h-dvh bg-sidebar flex flex-col transition-[transform,width] duration-200 ease-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            // Off-canvas drawer below md; docked from md up (§7.1).
            overlayOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
            // Widths per §7.1: drawer/overlay and the full desktop sidebar
            // are 240px; the icon rail is 56px from md up.
            collapsed ? "w-60 md:w-14" : "w-60",
          )}
        >
        {/* Header — compact "N" logo mark (§5), not the full workspace logo;
            the workspace's own logo image lives in the mobile topbar. */}
        {collapsed ? (
          <div className="shrink-0 px-2 py-2 border-b border-border-subtle flex flex-col items-center gap-1.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-sidebar-accent-foreground">
                N
              </span>
            </div>
            <div className="hidden md:flex flex-col items-center gap-1">
              <NotificationBell />
              <button
                type="button"
                onClick={handleExpand}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="p-1.5 rounded-lg text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
              >
                <PanelLeftOpen size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 px-3 py-2 border-b border-border-subtle flex items-center justify-between gap-2 overflow-hidden">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-sidebar-accent-foreground">
                  N
                </span>
              </div>
              <span className="text-sm font-semibold text-foreground truncate min-w-0">
                {companyName || ""}
              </span>
            </div>
            <div className="hidden md:flex flex-col items-center gap-1 shrink-0">
              <NotificationBell />
              <button
                type="button"
                onClick={handleCollapse}
                aria-label="Collapse sidebar"
                aria-expanded={true}
                className="p-1.5 rounded-lg text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Navigation — grouped per design-system §5. No top padding so the
            first item sits flush with the logo area's bottom border. */}
        <nav className="scrollbar-subtle flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-4">
          {visibleGroups.map((group, groupIdx) => (
            <div key={group.label ?? "pinned-top"}>
              {group.label &&
                (collapsed ? (
                  // Rail mode has no room for eyebrows — a hairline marks the
                  // group boundary instead.
                  <div
                    className="mx-2 mt-2 mb-2 border-t border-border-subtle"
                    aria-hidden
                  />
                ) : (
                  // Eyebrow label: 11px / 500 / 0.04em letter-spacing,
                  // --text-faint, sentence case (§3).
                  <div className="px-2.5 pt-4 pb-1 text-[11px] font-medium tracking-[0.04em] text-text-faint">
                    {group.label}
                  </div>
                ))}
              <div className={cn("space-y-1", groupIdx === 0 && "pt-2")}>
                {group.items.map((item) => renderNavLink(item))}
              </div>
            </div>
          ))}
        </nav>

        {/* Settings — pinned to the sidebar bottom with the workspace
            switcher and user footer (§5). */}
        <div className="shrink-0 px-3 py-2 border-t border-border-subtle">
          {renderNavLink(settingsNavItem)}
        </div>

        {/* Workspace switcher (renders null for single-org users) */}
        <WorkspaceSwitcher collapsed={collapsed} />

        {/* User footer */}
        <div className="shrink-0 px-3 py-3 border-t border-border-subtle">
          {profile ? (
            collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0"
                  title={`${profile.full_name} — ${profile.role.replace("_", " ")}`}
                >
                  <span className="text-xs font-semibold text-sidebar-accent-foreground">{initials}</span>
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger
                    render={
                      <button
                        onClick={handleSignOut}
                        className="p-1.5 rounded-lg text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
                        aria-label="Sign out"
                      >
                        <LogOut size={16} />
                      </button>
                    }
                  />
                  <Tooltip.Portal>
                    <Tooltip.Positioner side="right" sideOffset={8}>
                      <Tooltip.Popup className="z-50 rounded-md bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-lg ring-1 ring-border">
                        Sign out
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-sidebar-accent-foreground">{initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {profile.full_name}
                  </p>
                  <p className="text-[10px] text-text-faint capitalize">
                    {profile.role.replace("_", " ")}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 rounded-lg text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )
          ) : (
            <p className="text-text-faint text-xs">Nookleus</p>
          )}
        </div>
        </aside>
      </Tooltip.Provider>
    </>
  );
}
