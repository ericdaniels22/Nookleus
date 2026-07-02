import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared loading skeleton (design-system §5, #913): a shimmer-free `--muted`
 * block. Size it to match the final layout shape via `className` (e.g.
 * `h-8 w-24`) so loading reads as the same silhouette the content will fill.
 * Decorative, so `aria-hidden`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
