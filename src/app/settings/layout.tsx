"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { settingsNavItems } from "@/lib/settings-nav";
import { cn } from "@/lib/utils";
import { Settings, ChevronDown } from "lucide-react";

// The template editor (#543) renders in the full-width BuilderLayout shell, so
// it must escape the settings chrome (header + max-w-6xl column + sub-nav) and
// render bare — exactly as the estimate/invoice builders do outside /settings.
const BUILDER_ROUTE = /^\/settings\/estimate-templates\/[^/]+\/edit(\/|$)/;

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  if (BUILDER_ROUTE.test(pathname)) {
    return <>{children}</>;
  }

  const currentItem = settingsNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Settings size={22} className="text-[var(--brand-primary)]" />
        <h1 className="text-3xl font-extrabold text-foreground">Settings</h1>
      </div>

      {/* Mobile nav dropdown */}
      <div className="md:hidden mb-4">
        <div className="relative">
          <select
            value={currentItem?.href || ""}
            onChange={(e) => router.push(e.target.value)}
            className="w-full appearance-none bg-card border border-border rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
          >
            {settingsNavItems
              .filter((item) => !item.disabled)
              .map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-52 shrink-0">
          <nav className="space-y-0.5">
            {settingsNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              const Icon = item.icon;

              if (item.disabled) {
                return (
                  <div
                    key={item.href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed"
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
