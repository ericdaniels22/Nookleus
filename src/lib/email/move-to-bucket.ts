import { toast } from "sonner";
import { CATEGORY_LABELS, type Category } from "@/lib/email-categorizer";

interface MoveEmailsOptions {
  ids: string[];
  category: Category;
  // Set only for a single-email move (row or reader). Its presence is what
  // turns on the one-tap "always file this sender here" Sender rule offer — a
  // multi-select move can span senders, so it just moves (#957).
  fromAddress?: string;
  // Called after the emails move, and again after a Sender rule re-files, so
  // the caller can refresh the list + unread counts.
  onChanged?: () => void;
}

/**
 * Move one or more emails into a bucket, then — for a single-email move —
 * surface a toast offering to always file that sender there. The move itself
 * locks each email (category_locked) server-side so it never snaps back.
 */
export async function moveEmails({
  ids,
  category,
  fromAddress,
  onChanged,
}: MoveEmailsOptions): Promise<void> {
  try {
    const res = await fetch("/api/email/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "move", category }),
    });
    if (!res.ok) throw new Error("Move failed");
  } catch {
    toast.error("Move failed");
    return;
  }

  onChanged?.();

  const label = CATEGORY_LABELS[category];
  if (fromAddress) {
    toast.success(`Moved to ${label}`, {
      action: {
        label: "Always file sender",
        onClick: () => teachSenderRule(fromAddress, category, onChanged),
      },
    });
  } else {
    toast.success(`Moved ${ids.length} to ${label}`);
  }
}

/**
 * Accept the one-tap offer: create/refresh the Sender rule and retroactively
 * re-file the sender's existing inbox mail. Manual moves are preserved by the
 * server (locked mail is skipped).
 */
async function teachSenderRule(
  fromAddress: string,
  category: Category,
  onChanged?: () => void,
): Promise<void> {
  try {
    const res = await fetch("/api/email/sender-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromAddress, category }),
    });
    if (!res.ok) throw new Error("Sender rule failed");
    const data = (await res.json()) as { refiled?: number };
    const label = CATEGORY_LABELS[category];
    const refiled = data.refiled ?? 0;
    toast.success(
      refiled > 0
        ? `Filing ${fromAddress} in ${label} (${refiled} re-filed)`
        : `Filing ${fromAddress} in ${label}`,
    );
    onChanged?.();
  } catch {
    toast.error("Couldn't save sender rule");
  }
}
