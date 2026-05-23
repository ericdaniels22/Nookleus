"use client";

import { format } from "date-fns";
import { Send, Inbox, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Email } from "@/lib/types";
import { EmailBodyFrame } from "@/components/email/email-body-frame";
import { EmailAttachments } from "@/components/email/email-attachments";

export function JobEmailRow({
  email,
  isExpanded,
  onToggle,
  onReply,
}: {
  email: Email;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: () => void;
}) {
  const isSent = email.folder === "sent" || email.folder === "drafts";
  const toLine = (email.to_addresses || []).map((a) => a.name || a.email).join(", ");
  const ccLine = (email.cc_addresses || []).map((a) => a.name || a.email).join(", ");
  const bccLine = (email.bcc_addresses || []).map((a) => a.name || a.email).join(", ");
  const showCc = (email.cc_addresses || []).length > 0;
  const showBcc = isSent && (email.bcc_addresses || []).length > 0;

  const directionIcon = isSent
    ? <Send size={14} className="text-primary" />
    : <Inbox size={14} className="text-primary" />;

  const iconBg = isSent ? "bg-primary/10" : "bg-vibrant-blue/10";
  const folderBadge = isSent ? "bg-[#E1F5EE] text-[#085041]" : "bg-[#E6F1FB] text-[#0C447C]";

  const fromDisplay = isSent
    ? "To: " + toLine
    : "From: " + (email.from_name || email.from_address);

  const fullFrom = email.from_name
    ? email.from_name + " (" + email.from_address + ")"
    : email.from_address;

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 hover:bg-accent/50 transition-colors text-left"
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", iconBg)}>
          {directionIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-medium text-foreground truncate", !email.is_read && "font-bold")}>
              {email.subject || "(No Subject)"}
            </p>
            <Badge className={cn("text-[10px] px-1.5 py-0 rounded flex-shrink-0", folderBadge)}>
              {email.folder}
            </Badge>
            {email.matched_by && (
              <Badge className="text-[10px] px-1.5 py-0 rounded bg-muted text-[#666] flex-shrink-0">
                {email.matched_by}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground truncate">{fromDisplay}</p>
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1 flex-shrink-0">
              <Clock size={10} />
              {format(new Date(email.received_at), "MMM d, h:mm a")}
            </span>
          </div>
          {!isExpanded && email.snippet && (
            <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-1">{email.snippet}</p>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/50">
          <div className="mt-3 text-xs text-muted-foreground space-y-1 mb-3">
            <p><span className="font-medium text-foreground/80">From:</span> {fullFrom}</p>
            <p><span className="font-medium text-foreground/80">To:</span> {toLine}</p>
            {showCc && (
              <p><span className="font-medium text-foreground/80">CC:</span> {ccLine}</p>
            )}
            {showBcc && (
              <p><span className="font-medium text-foreground/80">BCC:</span> {bccLine}</p>
            )}
            <p><span className="font-medium text-foreground/80">Date:</span> {format(new Date(email.received_at), "EEEE, MMM d, yyyy 'at' h:mm a")}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/80 leading-relaxed max-h-80 overflow-y-auto">
            {email.body_html ? (
              <EmailBodyFrame html={email.body_html} />
            ) : (
              <div className="whitespace-pre-wrap">
                {email.body_text || email.snippet || "(No content)"}
              </div>
            )}
          </div>
          {email.has_attachments && (
            <div className="mt-3">
              <EmailAttachments
                attachments={email.attachments}
                hasAttachments={email.has_attachments}
              />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onReply(); }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Send size={12} /> Reply
          </button>
        </div>
      )}
    </div>
  );
}
