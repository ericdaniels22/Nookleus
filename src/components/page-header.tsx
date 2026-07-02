import { cn } from "@/lib/utils";

/**
 * The shared page header (design-system §4, #912): title + subtitle on the
 * left, secondary action(s) + the single primary action on the right. This
 * header row is the only place a solid `--primary` button lives — pass it
 * via `actions`, last.
 *
 * Type scale per §3: title 20px/600 in the neutral foreground (never
 * accent), subtitle 13px/400 `--muted-foreground`.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle != null && (
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions != null && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
