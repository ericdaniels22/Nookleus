export type BotReason = "no_reply_address" | "bot_display_name" | "automated_header";

export interface EmailForBotDetection {
  from_address: string;
  from_name?: string | null;
  headers?: Record<string, string> | null;
}

export interface BotDetection {
  isBot: boolean;
  reason: BotReason | null;
}

/**
 * Decide whether an email came from an automated (bot) sender rather than a
 * human. Presentation-only: the verdict drives inbox grouping, never message
 * storage. Signals, in priority order:
 *   1. bot_display_name — the display name or address carries a "[bot]" tag
 *   2. no_reply_address — the local part looks like no-reply/do-not-reply
 *   3. automated_header — a header marks the mail as machine-generated
 */
export function detectBotSender(email: EmailForBotDetection): BotDetection {
  const address = (email.from_address || "").toLowerCase();
  const name = email.from_name || "";

  // 1. "[bot]" tag on the display name or address (e.g. "vercel[bot]").
  if (/\[bot\]/i.test(name) || /\[bot\]/i.test(address)) {
    return { isBot: true, reason: "bot_display_name" };
  }

  // 2. no-reply / do-not-reply local part.
  const localPart = address.split("@")[0] || "";
  const localAlpha = localPart.replace(/[^a-z]/g, "");
  if (localAlpha.includes("noreply") || localAlpha.includes("donotreply")) {
    return { isBot: true, reason: "no_reply_address" };
  }

  // 3. machine-generated header signals.
  if (hasAutomatedHeader(email.headers)) {
    return { isBot: true, reason: "automated_header" };
  }

  return { isBot: false, reason: null };
}

/**
 * RFC 3834 / de-facto auto-mail header signals. Values are compared
 * case-insensitively; header keys are assumed already lowercased by the
 * parser (`ParsedEmail.headers`).
 */
const PRECEDENCE_BOT_VALUES = new Set(["bulk", "list", "junk", "auto_reply"]);

function hasAutomatedHeader(headers: Record<string, string> | null | undefined): boolean {
  if (!headers) return false;

  // Auto-Submitted: anything other than "no" (RFC 3834) means auto-generated.
  const autoSubmitted = headers["auto-submitted"];
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== "no") {
    return true;
  }

  const precedence = headers["precedence"];
  if (precedence && PRECEDENCE_BOT_VALUES.has(precedence.trim().toLowerCase())) {
    return true;
  }

  if ("x-auto-response-suppress" in headers) return true;
  if ("x-autoreply" in headers) return true;
  if ("x-autorespond" in headers) return true;

  return false;
}
