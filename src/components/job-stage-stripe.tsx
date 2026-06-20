import { getJobStatusPresentation } from "@/lib/job-status-presentation";
import { cn } from "@/lib/utils";

export function JobStageStripe({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-testid="stage-stripe"
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 w-1",
        className,
      )}
      style={{ backgroundColor: getJobStatusPresentation(status).accentColor }}
    />
  );
}
