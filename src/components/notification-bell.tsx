"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Check, Briefcase, CreditCard, Camera, Mail, AlertTriangle, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  job_id: string | null;
  created_at: string;
  href: string | null;
  priority: "normal" | "high";
  metadata: Record<string, unknown>;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  new_job: Briefcase,
  status_change: Briefcase,
  payment: CreditCard,
  activity: Clock,
  photo: Camera,
  email: Mail,
  overdue: AlertTriangle,
  reminder: Clock,
  // 17c additions
  payment_received: CreditCard,
  payment_failed: AlertTriangle,
  refund_issued: CreditCard,
  dispute_opened: AlertTriangle,
  qb_sync_failed: AlertTriangle,
};

// Categorical icon tints — §2.7 chart hues (--chart-1…5) for non-semantic
// types; the semantic ones stay on --primary / --destructive.
const TYPE_COLORS: Record<string, string> = {
  new_job: "text-primary",
  status_change: "text-chart-2",
  payment: "text-primary",
  activity: "text-muted-foreground",
  photo: "text-chart-4",
  email: "text-chart-2",
  overdue: "text-destructive",
  reminder: "text-chart-3",
  // 17c additions
  payment_received: "text-primary",
  payment_failed: "text-destructive",
  refund_issued: "text-chart-3",
  dispute_opened: "text-destructive",
  qb_sync_failed: "text-destructive",
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    // The target user is the authenticated caller, derived server-side
    // from the session (#119) — no user id is sent.
    const res = await fetch(`/api/notifications?limit=15`);
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    // Poll every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function markAsRead(id: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    if (!user) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 min-w-[18px] flex items-center justify-center rounded-full bg-destructive text-white text-[10px] font-bold leading-none px-1 animate-pulse-glow">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-52 top-2 w-80 bg-card border border-border rounded-xl shadow-2xl ring-1 ring-primary/10 z-[100] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
              >
                <Check size={12} />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications list */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                const color = TYPE_COLORS[n.type] || "text-muted-foreground";
                const content = (
                  <div
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer border-b border-border/50 last:border-b-0",
                      !n.is_read && "bg-primary/5",
                      n.priority === "high" && "border-l-2 border-l-destructive"
                    )}
                    onClick={() => {
                      if (!n.is_read) markAsRead(n.id);
                      setOpen(false);
                    }}
                  >
                    <Icon size={16} className={cn("mt-0.5 shrink-0", color)} />
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm", n.is_read ? "text-muted-foreground" : "text-foreground font-medium")}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {format(new Date(n.created_at), "MMM d, h:mm a")}
                      </p>
                    </div>
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </div>
                );

                const href = n.href ?? (n.job_id ? `/jobs/${n.job_id}` : null);
                return href ? (
                  <Link key={n.id} href={href}>{content}</Link>
                ) : (
                  <div key={n.id}>{content}</div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border">
            <Link
              href="/settings/notifications"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
