"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Thin banner rendered at the top of /accounting pages whenever a previously
// set-up connection has gone inactive. Stays out of the way if there's no
// connection yet (pre-setup) or if everything is healthy.
export default function QbExpiredBanner() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    fetch("/api/qb/connection")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const hadSetup = data.setup_completed_at != null;
        const refreshExpired =
          data.refresh_token_expires_at &&
          Date.parse(data.refresh_token_expires_at) < Date.now();
        if (hadSetup && (!data.is_active || refreshExpired)) {
          setExpired(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!expired) return null;
  return (
    <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm">
      <AlertTriangle className="text-red-600 shrink-0" size={18} />
      <span className="flex-1 text-red-700">
        QuickBooks connection expired. Reconnect to resume sync.
      </span>
      <Link
        href="/settings/money?tab=quickbooks"
        className="px-3 py-1 rounded bg-red-500 text-white text-xs font-medium hover:brightness-110"
      >
        Reconnect
      </Link>
    </div>
  );
}
