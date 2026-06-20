import {
  Sprout,
  Hammer,
  Banknote,
  CheckCircle2,
  Frown,
  Circle,
  type LucideIcon,
} from "lucide-react";

import { getJobStatusPresentation } from "@/lib/job-status-presentation";
import { cn } from "@/lib/utils";

// The lucide component for each icon NAME the #720 presentation module records.
// Holding the imports here — rather than resolving the stored string at runtime
// — keeps the icon set tree-shakeable and type-checked.
const STAGE_ICONS: Record<string, LucideIcon> = {
  Sprout,
  Hammer,
  Banknote,
  CheckCircle2,
  Frown,
  Circle,
};

export function JobStageIcon({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const Icon = STAGE_ICONS[getJobStatusPresentation(status).icon] ?? Circle;
  return (
    <Icon
      aria-hidden
      data-testid="stage-icon"
      size={14}
      className={cn("shrink-0", className)}
    />
  );
}
