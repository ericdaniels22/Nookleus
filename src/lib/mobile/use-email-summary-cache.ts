"use client";

import { useEffect } from "react";

import {
  shapeEmailSummary,
  type EmailSummaryAccount,
  type EmailSummaryEmail,
} from "./email-summary";
import { publishEmailSummary } from "./email-widget-bridge";

/**
 * Web summary producer (issue #173, PRD #56 slice 2).
 *
 * Once the inbox has loaded, this hook shapes the per-account email summary
 * and hands it to the native shell to cache for the iOS Emails widget. It is
 * a no-op off the native iOS shell — see {@link publishEmailSummary}.
 *
 * @param emails   The loaded inbox emails.
 * @param accounts The email accounts the caller can read.
 * @param enabled  Pass `false` while a non-inbox folder is shown so the cache
 *                 keeps its last inbox snapshot instead of being clobbered.
 */
export function useEmailSummaryCache(
  emails: EmailSummaryEmail[],
  accounts: EmailSummaryAccount[],
  enabled: boolean,
): void {
  useEffect(() => {
    // Skip until accounts have loaded — publishing an account-less snapshot
    // would clobber a good cache with nothing.
    if (!enabled || accounts.length === 0) return;

    const snapshot = shapeEmailSummary(
      { emails, accounts },
      new Date().toISOString(),
    );
    // Fire-and-forget: a failed widget-cache write must never disrupt the
    // inbox the user is actually looking at.
    void publishEmailSummary(snapshot).catch(() => {});
  }, [emails, accounts, enabled]);
}
