import SwiftUI
import WidgetKit

/// Entry point for the Nookleus WidgetKit extension.
///
/// - Quick Actions (#172): a data-free deep-link widget, iOS 15+.
/// - Emails (#174): the data-backed per-mailbox widget. It uses
///   `AppIntentConfiguration`, so it is iOS 17+ and is included conditionally.
@main
struct NookleusWidgetsBundle: WidgetBundle {
    var body: some Widget {
        QuickActionsWidget()
        if #available(iOS 17.0, *) {
            EmailsWidget()
        }
    }
}
