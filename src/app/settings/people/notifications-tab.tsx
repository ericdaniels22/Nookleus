"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";

const NOTIFICATION_TYPES = [
  { key: "new_job", label: "New Job Created", description: "When a new intake is submitted" },
  { key: "status_change", label: "Job Status Changed", description: "When a job status is updated" },
  { key: "payment", label: "Payment Received", description: "When a payment is recorded" },
  { key: "activity", label: "Crew Activity", description: "When crew logs an activity or note" },
  { key: "photo", label: "Photo Uploaded", description: "When photos are added to a job" },
  { key: "email", label: "Email Received", description: "When an email matches a job" },
  { key: "overdue", label: "Overdue Payment", description: "When a payment passes the due date" },
  { key: "reminder", label: "Reminders", description: "Moisture checks, adjuster follow-ups" },
];

const DELIVERY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "in_app", label: "In-App" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both" },
];

export function NotificationsTab() {
  const { user, loading: authLoading } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPrefs = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      // Set defaults even without user
      const map: Record<string, string> = {};
      for (const t of NOTIFICATION_TYPES) map[t.key] = "in_app";
      setPrefs(map);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("notification_preferences")
      .select("notification_type, delivery_method")
      .eq("user_id", user.id);

    const map: Record<string, string> = {};
    for (const t of NOTIFICATION_TYPES) {
      map[t.key] = "in_app";
    }
    if (data) {
      for (const p of data) {
        map[p.notification_type] = p.delivery_method;
      }
    }
    setPrefs(map);
    setLoading(false);
  }, [user, authLoading]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  function updatePref(type: string, method: string) {
    setPrefs((prev) => ({ ...prev, [type]: method }));
  }

  async function handleSave() {
    setSaving(true);

    const supabase = createClient();

    // Get user directly if auth context hasn't loaded
    let userId = user?.id;
    if (!userId) {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      userId = currentUser?.id;
    }

    if (!userId) {
      toast.error("Not signed in. Please refresh and try again.");
      setSaving(false);
      return;
    }

    const upserts = Object.entries(prefs).map(([notification_type, delivery_method]) => ({
      user_id: userId,
      notification_type,
      delivery_method,
    }));

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(upserts, { onConflict: "user_id,notification_type" });

    if (error) {
      toast.error("Failed to save preferences");
    } else {
      toast.success("Notification preferences saved");
    }
    setSaving(false);
  }

  // The header sits outside the loading branch so the "personal setting"
  // disclosure is visible even while preferences are still fetching.
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Personal setting — these preferences only affect you, not other people in
          your organization. Choose how you want to be notified about platform events.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_repeat(4,64px)] gap-0 px-4 py-3 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Event
              </span>
              {DELIVERY_OPTIONS.map((opt) => (
                <span key={opt.value} className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
                  {opt.label}
                </span>
              ))}
            </div>

            {/* Rows */}
            {NOTIFICATION_TYPES.map((type, i) => (
              <div
                key={type.key}
                className={cn(
                  "grid grid-cols-[1fr_repeat(4,64px)] gap-0 px-4 py-3 items-center",
                  i < NOTIFICATION_TYPES.length - 1 && "border-b border-border"
                )}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{type.label}</p>
                  <p className="text-xs text-muted-foreground">{type.description}</p>
                </div>
                {DELIVERY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex justify-center">
                    <input
                      type="radio"
                      name={`pref-${type.key}`}
                      checked={prefs[type.key] === opt.value}
                      onChange={() => updatePref(type.key, opt.value)}
                      className="w-4 h-4 accent-[var(--brand-primary)] cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
