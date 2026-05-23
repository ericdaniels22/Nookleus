import { format } from "date-fns";
import type { Email } from "@/lib/types";

export function buildQuotedReply(email: Email): string {
  const date = format(new Date(email.received_at), "MMM d, yyyy 'at' h:mm a");
  const from = email.from_name
    ? `${email.from_name} &lt;${email.from_address}&gt;`
    : email.from_address;
  const originalBody = email.body_html || `<p>${(email.body_text || "").replace(/\n/g, "<br>")}</p>`;
  return `<br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">
      <p style="margin: 0 0 8px; font-size: 12px;">On ${date}, ${from} wrote:</p>
      ${originalBody}
    </div>`;
}
