import { Capacitor, registerPlugin } from "@capacitor/core";

import type { EmailSummarySnapshot } from "./email-summary";

/**
 * The native `EmailWidgetBridge` Capacitor plugin (issue #173, PRD #56
 * slice 2). Implemented in Swift in the iOS App target — see
 * `ios/App/App/EmailWidgetBridgePlugin.swift`. There is no web
 * implementation; {@link publishEmailSummary} short-circuits off-native.
 */
export interface EmailWidgetBridgePlugin {
  /** Writes the summary JSON into the shared App Group container. */
  writeEmailSummary(options: { summary: string }): Promise<void>;
  /** Reloads every widget timeline so the new summary is rendered. */
  reloadWidgets(): Promise<void>;
}

const EmailWidgetBridge =
  registerPlugin<EmailWidgetBridgePlugin>("EmailWidgetBridge");

/**
 * Caches the email summary for the iOS Emails widget: writes the snapshot
 * into the App Group container, then reloads the widget timelines.
 *
 * A no-op everywhere but the native iOS shell — the WidgetKit extension and
 * the App Group only exist there, and the web app has no widget to feed.
 */
export async function publishEmailSummary(
  snapshot: EmailSummarySnapshot,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await EmailWidgetBridge.writeEmailSummary({
    summary: JSON.stringify(snapshot),
  });
  await EmailWidgetBridge.reloadWidgets();
}
