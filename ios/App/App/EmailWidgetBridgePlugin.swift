import Capacitor
import Foundation
import WidgetKit

/// `EmailWidgetBridge` Capacitor plugin — issue #173, PRD #56 slice 2.
///
/// Lets the Capacitor web app hand the native shell a per-account email
/// summary to cache for the Emails widget. Per the PRD #56 decision the
/// WidgetKit extension does no networking and no auth: it renders whatever
/// snapshot this plugin last wrote into the shared App Group container.
///
/// Registration is Swift-only via `CAPBridgedPlugin` — Capacitor discovers
/// the plugin at runtime, so no Objective-C `.m` macro file is required. The
/// file must be added to the `App` target's Compile Sources in Xcode; see
/// `ios/App/App/EmailWidgetBridge-SETUP.md`.
@objc(EmailWidgetBridgePlugin)
public class EmailWidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EmailWidgetBridgePlugin"
    public let jsName = "EmailWidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeEmailSummary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise),
    ]

    /// App Group shared with the NookleusWidgets extension (created in #172).
    private static let appGroupId = "group.com.aaacontracting.platform"

    /// `UserDefaults` key the Emails widget (#174) reads the summary JSON from.
    static let summaryDefaultsKey = "emailSummary"

    /// Writes the summary JSON string into the shared App Group container.
    @objc func writeEmailSummary(_ call: CAPPluginCall) {
        guard let summary = call.getString("summary") else {
            call.reject("writeEmailSummary requires a 'summary' JSON string")
            return
        }
        guard let defaults = UserDefaults(suiteName: Self.appGroupId) else {
            call.reject("App Group \(Self.appGroupId) is unavailable — check the entitlement")
            return
        }
        defaults.set(summary, forKey: Self.summaryDefaultsKey)
        call.resolve()
    }

    /// Reloads every widget timeline so the freshly written summary renders.
    @objc func reloadWidgets(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
