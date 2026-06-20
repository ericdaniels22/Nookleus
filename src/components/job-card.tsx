"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MapPin, User, Shield, Calendar } from "lucide-react";
import { format } from "date-fns";
import { Job } from "@/lib/types";
import { urgencyColors, urgencyLabels } from "@/lib/badge-colors";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";
import { JobStageStripe } from "@/components/job-stage-stripe";
import { JobStageIcon } from "@/components/job-stage-icon";

export default function JobCard({ job }: { job: Job }) {
  const { getStatusColor, getStatusLabel, getDamageTypeColor, getDamageTypeLabel, damageTypes } = useConfig();
  const isCompleted = job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact ? job.contact.full_name : "Unknown";

  // Get damage type color for top border
  const dtConfig = damageTypes.find((dt) => dt.name === job.damage_type);
  const accentColor = dtConfig?.text_color || "#666666";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "relative block bg-card rounded-xl border border-border overflow-hidden card-vibrant p-5 transition-all hover:-translate-y-1",
        isCompleted && "opacity-60"
      )}
    >
      {/* Stage color stripe — overflow-hidden clips it to the card's corners */}
      <JobStageStripe status={job.status} />

      {/* Gradient top strip */}
      <div
        className="h-[3px] -mx-5 -mt-5 mb-4"
        style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80)` }}
      />

      {/* Top row: job number + badges */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-mono text-muted-foreground">{job.job_number}</p>
          <p className="text-base font-semibold text-foreground mt-0.5">
            {contactName}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-md",
              urgencyColors[job.urgency]
            )}
          >
            {urgencyLabels[job.urgency]}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-md",
              getDamageTypeColor(job.damage_type)
            )}
          >
            {getDamageTypeLabel(job.damage_type)}
          </Badge>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="flex-shrink-0" />
          <span className="truncate">{job.property_address}</span>
        </div>
        <div className="flex items-center gap-2">
          <User size={14} className="flex-shrink-0" />
          <span>{contactName}</span>
        </div>
        {job.insurance_company && (
          <div className="flex items-center gap-2">
            <Shield size={14} className="flex-shrink-0" />
            <span>
              {job.insurance_company}
              {job.claim_number && ` — ${job.claim_number}`}
            </span>
          </div>
        )}
      </div>

      {/* Bottom row: date + status */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar size={12} />
          <span>{format(new Date(job.created_at), "MMM d, yyyy")}</span>
        </div>
        {/* Stage icon + status badge read together as "🔨 Active". The icon
            is decorative (the badge carries the label) and stays neutral so
            its glyph — not another color — is the at-a-glance stage cue. */}
        <div className="flex items-center gap-1.5">
          <JobStageIcon status={job.status} className="text-muted-foreground" />
          <Badge
            variant="secondary"
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-md",
              getStatusColor(job.status)
            )}
          >
            {getStatusLabel(job.status)}
          </Badge>
        </div>
      </div>
    </Link>
  );
}
