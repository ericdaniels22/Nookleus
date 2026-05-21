import SwiftUI
import WidgetKit

// MARK: - Deep-link actions

/// One Quick Actions button: a label, an SF Symbol, and the `nookleus://`
/// deep link it opens.
///
/// The host of each URL (`new-job`, `add-photo`, ...) must stay in sync with
/// the route map in `src/lib/mobile/deep-link.ts` on the web side.
struct QuickAction {
    let title: String
    let systemImage: String
    let url: URL
}

private let quickActions: [QuickAction] = [
    QuickAction(
        title: "New job",
        systemImage: "plus.square.on.square",
        url: URL(string: "nookleus://new-job")!
    ),
    QuickAction(
        title: "Add photo",
        systemImage: "camera.fill",
        url: URL(string: "nookleus://add-photo")!
    ),
    QuickAction(
        title: "Compose email",
        systemImage: "envelope.fill",
        url: URL(string: "nookleus://compose-email")!
    ),
    QuickAction(
        title: "Open Jarvis",
        systemImage: "sparkles",
        url: URL(string: "nookleus://jarvis")!
    ),
]

// MARK: - Timeline provider

struct QuickActionsEntry: TimelineEntry {
    let date: Date
}

/// The Quick Actions widget is fully static — no data, no auth, no network.
/// The provider returns a single entry and never asks WidgetKit to refresh.
struct QuickActionsProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickActionsEntry {
        QuickActionsEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickActionsEntry) -> Void) {
        completion(QuickActionsEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickActionsEntry>) -> Void) {
        completion(Timeline(entries: [QuickActionsEntry(date: Date())], policy: .never))
    }
}

// MARK: - Views

/// A single tappable Quick Actions tile. `Link` opens the deep link directly
/// from the home screen (supported in medium and large widget families).
struct QuickActionTile: View {
    let action: QuickAction

    var body: some View {
        Link(destination: action.url) {
            VStack(spacing: 6) {
                Image(systemName: action.systemImage)
                    .font(.title2)
                    .foregroundColor(.accentColor)
                Text(action.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.primary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(8)
            .background(Color.primary.opacity(0.06))
            .cornerRadius(12)
        }
    }
}

struct QuickActionsWidgetView: View {
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                QuickActionTile(action: quickActions[0])
                QuickActionTile(action: quickActions[1])
            }
            HStack(spacing: 8) {
                QuickActionTile(action: quickActions[2])
                QuickActionTile(action: quickActions[3])
            }
        }
    }
}

// MARK: - Widget

struct QuickActionsWidget: Widget {
    let kind: String = "QuickActionsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickActionsProvider()) { _ in
            if #available(iOS 17.0, *) {
                QuickActionsWidgetView()
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                QuickActionsWidgetView()
                    .padding()
            }
        }
        .configurationDisplayName("Quick Actions")
        .description("Jump straight into a new job, photo, email, or Jarvis.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Preview

#if DEBUG
@available(iOS 17.0, *)
#Preview("Quick Actions — medium", as: .systemMedium) {
    QuickActionsWidget()
} timeline: {
    QuickActionsEntry(date: Date())
}

@available(iOS 17.0, *)
#Preview("Quick Actions — large", as: .systemLarge) {
    QuickActionsWidget()
} timeline: {
    QuickActionsEntry(date: Date())
}
#endif
