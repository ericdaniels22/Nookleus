import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared empty state (design-system §5, #913): a muted Lucide icon + one-line
 * headline + one-line body + an optional CTA verb. Never a bare dashed box.
 * Every empty data widget uses this so "nothing here" always reads as
 * intentional and offers a way forward.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className="mb-1.5 size-7 text-muted-foreground"
        />
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description != null && (
        <p className="max-w-xs text-[13px] text-muted-foreground">
          {description}
        </p>
      )}
      {action != null && <div className="mt-3">{action}</div>}
    </div>
  );
}
