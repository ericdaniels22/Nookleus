import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A dashboard KPI metric card (design-system §5, #913): `--muted` surface,
 * label above value, tabular numerals. The value is neutral unless the metric
 * itself signals a warning (`tone="warning"`, e.g. an outstanding balance
 * running high). Pass `href` to make the whole card a link to the detail view;
 * pass `loading` to show a skeleton in the value slot matching the final shape.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  href,
  tone = "neutral",
  loading = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  tone?: "neutral" | "warning";
  loading?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && (
          <Icon aria-hidden size={15} className="shrink-0 text-muted-foreground" />
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-12" />
      ) : (
        <span
          className={cn(
            "mt-1 block text-[22px] font-semibold tabular-nums",
            tone === "warning" ? "text-warning" : "text-foreground",
          )}
        >
          {value}
        </span>
      )}
    </>
  );

  const base = "block rounded-lg border border-border bg-muted p-4";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "transition-colors hover:border-input",
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={cn(base, className)}>{body}</div>;
}
