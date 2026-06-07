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
/// Capacitor 8 does NOT auto-discover this plugin. It only instantiates the
/// classes named in `capacitor.config.json`'s `packageClassList` (regenerated
/// from the installed npm `@capacitor/*` packages by `npx cap sync ios`), and
/// the old Objective-C `CAP_PLUGIN` macro scan is gone — so being in the `App`
/// target's Compile Sources is necessary but not sufficient. The instance is
/// registered manually in `MainViewController.capacitorDidLoad()`; see
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
