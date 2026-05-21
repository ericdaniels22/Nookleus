import SwiftUI
import WidgetKit

/// Entry point for the Nookleus WidgetKit extension.
///
/// Slice 1 (#172) ships only the data-free Quick Actions widget. The Emails
/// widget (#174) is added to this bundle in a later slice.
@main
struct NookleusWidgetsBundle: WidgetBundle {
    var body: some Widget {
        QuickActionsWidget()
    }
}
