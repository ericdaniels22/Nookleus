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
import { navItems } from "@/lib/nav-items";
import { useNavOrder } from "@/lib/nav-order-context";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { Tooltip } from "@base-ui/react/tooltip";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { order } = useNavOrder();
  const { collapsed, toggle } = useSidebarCollapse();

  // Sort the canonical nav items by DB sort_order.
  // Items missing from the DB fall to the bottom in code-defined order.
  const sortedNavItems = [...navItems].sort((a, b) => {
    const aOrder = order.get(a.href) ?? Infinity;
    const bOrder = order.get(b.href) ?? Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return navItems.indexOf(a) - navItems.indexOf(b);
  });

  const [mobileOpen, setMobileOpen] = useState(false);

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

  const companyInitials =
    companyName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() || "•";

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

  return (
    <>
      {/* Mobile top bar. Top padding includes the iOS safe-area inset so the
          bar's content sits below the notch / status bar on Capacitor. The
          rendered logo is sized to keep the bar's content area at h-14, which
          is what consumers (AppShell, email inbox) assume when computing
          their own offsets. */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 gradient-sidebar border-b border-white/10 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] flex items-center justify-between">
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
            <span className="text-sm font-semibold text-white truncate max-w-[180px]">
              {companyName || ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-white/70 hover:text-white transition-colors"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-md"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Tooltip.Provider delay={300}>
        <aside
          className={cn(
            "fixed top-0 left-0 z-40 h-full gradient-sidebar flex flex-col transition-[transform,width] duration-200 ease-out",
            "lg:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            // Mobile overlay is always full sidebar width. Collapse only applies at lg+.
            collapsed ? "w-52 lg:w-16" : "w-52",
          )}
        >
        {/* Nookleus mark — platform identity. The workspace logo below is tenant identity. */}
        {!collapsed && (
          <div className="shrink-0 px-3 pt-3 pb-1">
            <Image
              src="/nookleus-lockup-240w.png"
              alt="Nookleus"
              width={120}
              height={82}
              priority
              className="h-6 w-auto opacity-90"
            />
          </div>
        )}
        {/* Logo area */}
        {collapsed ? (
          <div className="shrink-0 px-2 py-2 border-b border-white/10 flex flex-col items-center gap-1.5 overflow-hidden">
            {/* Logo mark (AAA initials square) */}
            <div className="w-10 h-10 rounded-lg bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
              <span className="text-[11px] font-bold text-white tracking-tight">
                {companyInitials}
              </span>
            </div>
            <div className="hidden lg:flex flex-col items-center gap-1">
              <NotificationBell />
              <button
                type="button"
                onClick={toggle}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <PanelLeftOpen size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2 overflow-hidden">
            {companyLogoUrl ? (
              <Image
                src={companyLogoUrl}
                alt={companyName || "Workspace"}
                width={120}
                height={120}
                className="h-auto w-auto max-h-16 max-w-[140px] object-contain"
                unoptimized
              />
            ) : (
              <span className="text-sm font-semibold text-white/90 truncate min-w-0">
                {companyName || ""}
              </span>
            )}
            <div className="hidden lg:flex flex-col items-center gap-1 shrink-0">
              <NotificationBell />
              <button
                type="button"
                onClick={toggle}
                aria-label="Collapse sidebar"
                aria-expanded={true}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Navigation. No top padding so the first item sits flush with the
            logo area's bottom border. */}
        <nav className="scrollbar-subtle flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-4 space-y-1">
          {sortedNavItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            const linkClassName = cn(
              "rounded-lg text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
                : "text-white/60 hover:text-white hover:bg-white/10",
              collapsed
                ? "flex items-center justify-center w-10 h-10 mx-auto"
                : "flex items-center gap-2.5 px-2.5 py-2",
            );

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
                  {item.label}
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
                    <Tooltip.Popup className="z-50 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10">
                      {item.label}
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </nav>

        {/* Workspace switcher (renders null for single-org users) */}
        <WorkspaceSwitcher collapsed={collapsed} />

        {/* User footer */}
        <div className="shrink-0 px-3 py-3 border-t border-white/10">
          {profile ? (
            collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm"
                  title={`${profile.full_name} — ${profile.role.replace("_", " ")}`}
                >
                  <span className="text-xs font-semibold text-white">{initials}</span>
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger
                    render={
                      <button
                        onClick={handleSignOut}
                        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                        aria-label="Sign out"
                      >
                        <LogOut size={16} />
                      </button>
                    }
                  />
                  <Tooltip.Portal>
                    <Tooltip.Positioner side="right" sideOffset={8}>
                      <Tooltip.Popup className="z-50 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10">
                        Sign out
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
                  <span className="text-xs font-semibold text-white">{initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate">
                    {profile.full_name}
                  </p>
                  <p className="text-[10px] text-white/40 capitalize">
                    {profile.role.replace("_", " ")}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )
          ) : (
            <p className="text-white/30 text-xs">Nookleus</p>
          )}
        </div>
        </aside>
      </Tooltip.Provider>
    </>
  );
}
