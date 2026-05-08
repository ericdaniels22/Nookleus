"use client";

import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";

export function InvoiceStatusPill({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 rounded text-xs ${getStatusBadgeClasses("invoice", status)}`}>
      {formatStatusLabel("invoice", status)}
    </span>
  );
}
