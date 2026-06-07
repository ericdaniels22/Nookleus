import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Cache contract
//
// The Emails widget (PRD #56, slice 3, issue #174) renders the per-account
// snapshot written by the slice 2 (#173) cache pipeline. It does NO networking
// and NO auth — it only decodes and displays whatever the app last wrote into
// the shared App Group container.
//
// The JSON schema mirrors `EmailSummarySnapshot` in
// `src/lib/mobile/email-summary.ts`. Change one side, change the other.

// These mirror the JSON the app writes; the widget only ever DECODES them
// (the web side in `email-summary.ts` is the sole producer), so `Decodable` is
// all that's needed — and dropping `Encodable` lets the lenient initializers
// below stay fully explicit with no synthesis ambiguity.

struct EmailSummaryPreview: Decodable, Identifiable {
    let id: String
    let sender: String
    let subject: String
}

struct AccountEmailSummary: Decodable {
    let accountId: String
    let label: String
    let unreadCount: Int
    let previews: [EmailSummaryPreview]
    /// ISO 8601 timestamp — when the app last wrote this account's summary.
    let updatedAt: String
}

struct EmailSummarySnapshot: Decodable {
    let generatedAt: String
    let accounts: [String: AccountEmailSummary]
}

// MARK: - Lenient decoding (issue #175)
//
// `EmailSummaryStore.loadSnapshot()` decodes with `try?`, so ANY decode error —
// e.g. a JSON `null` where a non-optional `String` is expected — would discard
// the ENTIRE snapshot and blank the widget. These initializers coalesce a
// missing-or-null leaf field to a sane default so one bad value can't take down
// the whole face. Keeping them in extensions preserves each struct's memberwise
// initializer, which the sample data below relies on.

extension EmailSummaryPreview {
    enum CodingKeys: String, CodingKey { case id, sender, subject }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? ""
        subject = try c.decodeIfPresent(String.self, forKey: .subject) ?? ""
    }
}

extension AccountEmailSummary {
    enum CodingKeys: String, CodingKey {
        case accountId, label, unreadCount, previews, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accountId = try c.decodeIfPresent(String.self, forKey: .accountId) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        previews = try c.decodeIfPresent([EmailSummaryPreview].self, forKey: .previews) ?? []
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

extension EmailSummarySnapshot {
    enum CodingKeys: String, CodingKey { case generatedAt, accounts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        accounts = try c.decodeIfPresent([String: AccountEmailSummary].self, forKey: .accounts) ?? [:]
    }
}

// MARK: - App Group store

/// Reads the email-summary snapshot the native shell writes (see
/// `EmailWidgetBridgePlugin.swift`). Returns `nil` when no cache exists yet —
/// the widget shows its "open the app to sync" empty state in that case.
enum EmailSummaryStore {
    static let appGroupID = "group.com.aaacontracting.platform"
    static let key = "emailSummary"

    static func loadSnapshot() -> EmailSummarySnapshot? {
        guard
            let defaults = UserDefaults(suiteName: appGroupID),
            let json = defaults.string(forKey: key),
            let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(EmailSummarySnapshot.self, from: data)
    }
}

// MARK: - Deep links
//
// The host/query format is parsed by `parseDeepLink` in
// `src/lib/mobile/deep-link.ts`. `nookleus://email?account=<id>` opens that
// account's inbox; `nookleus://email?id=<id>` opens that specific email.

private func emailDeepLink(_ name: String, _ value: String) -> URL {
    var components = URLComponents()
    components.scheme = "nookleus"
    components.host = "email"
    components.queryItems = [URLQueryItem(name: name, value: value)]
    return components.url ?? URL(string: "nookleus://email")!
}

private func accountInboxURL(_ accountId: String) -> URL {
    emailDeepLink("account", accountId)
}

private func emailURL(_ emailId: String) -> URL {
    emailDeepLink("id", emailId)
}

// MARK: - Freshness

/// Parses an ISO 8601 string. The web side writes `Date.toISOString()`, which
/// always carries fractional seconds, so that variant is tried first.
private func parseISO8601(_ value: String) -> Date? {
    let withFractional = ISO8601DateFormatter()
    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFractional.date(from: value) { return date }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: value)
}

/// "Updated Xh ago" line backed by the snapshot timestamp. The timeline is
/// refreshed hourly (see the provider) so this stays roughly current even
/// while the app is closed.
private func freshnessText(_ updatedAt: String) -> String {
    guard let date = parseISO8601(updatedAt) else { return "" }
    let seconds = max(0, Date().timeIntervalSince(date))
    if seconds < 60 { return "Updated just now" }

    let minutes = Int(seconds / 60)
    if minutes < 60 { return "Updated \(minutes)m ago" }

    let hours = minutes / 60
    if hours < 24 { return "Updated \(hours)h ago" }

    return "Updated \(hours / 24)d ago"
}

// MARK: - Configuration intent
//
// Each widget instance is pinned to one mailbox. The picker is sourced from
// the cached snapshot's accounts — no networking, consistent with the
// extension never touching auth or the API.

@available(iOS 17.0, *)
struct MailboxEntity: AppEntity {
    let id: String
    let label: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Mailbox")
    }

    static var defaultQuery = MailboxQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(label)")
    }
}

@available(iOS 17.0, *)
struct MailboxQuery: EntityQuery {
    func entities(for identifiers: [MailboxEntity.ID]) async throws -> [MailboxEntity] {
        Self.allMailboxes().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [MailboxEntity] {
        Self.allMailboxes()
    }

    func defaultResult() async -> MailboxEntity? {
        Self.allMailboxes().first
    }

    /// Every mailbox present in the cached snapshot, sorted by label.
    static func allMailboxes() -> [MailboxEntity] {
        guard let accounts = EmailSummaryStore.loadSnapshot()?.accounts else { return [] }
        return accounts.values
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            .map { MailboxEntity(id: $0.accountId, label: $0.label) }
    }
}

@available(iOS 17.0, *)
struct SelectMailboxIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Select Mailbox"
    static var description = IntentDescription("Choose which mailbox this widget shows.")

    @Parameter(title: "Mailbox")
    var mailbox: MailboxEntity?
}

// MARK: - Timeline

@available(iOS 17.0, *)
struct EmailsEntry: TimelineEntry {
    let date: Date
    /// The configured account's summary, or `nil` when no cache exists yet.
    let summary: AccountEmailSummary?
}

@available(iOS 17.0, *)
struct EmailsProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> EmailsEntry {
        EmailsEntry(date: Date(), summary: .placeholder)
    }

    func snapshot(
        for configuration: SelectMailboxIntent,
        in context: Context
    ) async -> EmailsEntry {
        entry(for: configuration)
    }

    func timeline(
        for configuration: SelectMailboxIntent,
        in context: Context
    ) async -> Timeline<EmailsEntry> {
        // The app reloads timelines whenever it writes a fresh snapshot, so
        // the widget never polls for data. The hourly refresh only ages the
        // "Updated Xh ago" line while the app stays closed.
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
            ?? Date().addingTimeInterval(3600)
        return Timeline(entries: [entry(for: configuration)], policy: .after(nextRefresh))
    }

    private func entry(for configuration: SelectMailboxIntent) -> EmailsEntry {
        let snapshot = EmailSummaryStore.loadSnapshot()
        let summary: AccountEmailSummary?
        if let accountId = configuration.mailbox?.id {
            summary = snapshot?.accounts[accountId]
        } else {
            // Not configured yet — fall back to the first available mailbox.
            summary = snapshot?.accounts.values
                .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
                .first
        }
        return EmailsEntry(date: Date(), summary: summary)
    }
}

// MARK: - Views

@available(iOS 17.0, *)
struct EmailsWidgetView: View {
    let entry: EmailsEntry

    var body: some View {
        if let summary = entry.summary {
            EmailsContentView(summary: summary)
        } else {
            EmailsEmptyView()
        }
    }
}

/// Shown when no snapshot has been written yet (fresh install / signed out).
/// Tapping anywhere opens the app, which writes the cache on next foreground.
struct EmailsEmptyView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "envelope.badge")
                .font(.largeTitle)
                .foregroundColor(.accentColor)
            Text("Nookleus")
                .font(.headline)
                .foregroundColor(.primary)
            Text("Open the app to sync")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(URL(string: "nookleus://email"))
    }
}

@available(iOS 17.0, *)
struct EmailsContentView: View {
    @Environment(\.widgetFamily) private var family
    let summary: AccountEmailSummary

    /// Medium has room for two previews; large fits the full three.
    private var previewLimit: Int { family == .systemLarge ? 3 : 2 }

    private var shownPreviews: [EmailSummaryPreview] {
        Array(summary.previews.prefix(previewLimit))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header — mailbox label + unread count. Opens the account inbox.
            Link(destination: accountInboxURL(summary.accountId)) {
                HStack(alignment: .firstTextBaseline) {
                    Text(summary.label)
                        .font(.headline)
                        .lineLimit(1)
                        .foregroundColor(.primary)
                    Spacer(minLength: 8)
                    UnreadBadge(count: summary.unreadCount)
                }
            }

            Divider()

            if shownPreviews.isEmpty {
                Spacer(minLength: 0)
                Text("No recent messages")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
            } else {
                ForEach(shownPreviews) { preview in
                    // Each row opens that specific email.
                    Link(destination: emailURL(preview.id)) {
                        PreviewRow(preview: preview)
                    }
                }
                Spacer(minLength: 0)
            }

            Text(freshnessText(summary.updatedAt))
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Fallback tap target for anything outside an explicit Link.
        .widgetURL(accountInboxURL(summary.accountId))
    }
}

struct UnreadBadge: View {
    let count: Int

    var body: some View {
        Text(count == 0 ? "All read" : "\(count) unread")
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundColor(count == 0 ? .secondary : .white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(count == 0 ? Color.clear : Color.accentColor)
            .clipShape(Capsule())
    }
}

struct PreviewRow: View {
    let preview: EmailSummaryPreview

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(preview.sender)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(1)
                .foregroundColor(.primary)
            Text(preview.subject)
                .font(.caption2)
                .lineLimit(1)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Widget

@available(iOS 17.0, *)
struct EmailsWidget: Widget {
    let kind: String = "EmailsWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectMailboxIntent.self,
            provider: EmailsProvider()
        ) { entry in
            EmailsWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Emails")
        .description("Unread count and latest messages for one mailbox.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Sample data

@available(iOS 17.0, *)
extension AccountEmailSummary {
    /// Stand-in shown in the widget gallery and while the timeline loads.
    static let placeholder = AccountEmailSummary(
        accountId: "sample",
        label: "Team Inbox",
        unreadCount: 3,
        previews: [
            EmailSummaryPreview(
                id: "sample-1",
                sender: "Pat Adjuster",
                subject: "Roof leak claim — photos attached"
            ),
            EmailSummaryPreview(
                id: "sample-2",
                sender: "scheduling@supplier.com",
                subject: "Delivery confirmed for Thursday"
            ),
            EmailSummaryPreview(
                id: "sample-3",
                sender: "Jordan Lee",
                subject: "Re: estimate approval"
            ),
        ],
        updatedAt: ISO8601DateFormatter().string(from: Date())
    )
}

// MARK: - Preview

#if DEBUG
@available(iOS 17.0, *)
#Preview("Emails — medium", as: .systemMedium) {
    EmailsWidget()
} timeline: {
    EmailsEntry(date: Date(), summary: .placeholder)
    EmailsEntry(date: Date(), summary: nil)
}

@available(iOS 17.0, *)
#Preview("Emails — large", as: .systemLarge) {
    EmailsWidget()
} timeline: {
    EmailsEntry(date: Date(), summary: .placeholder)
}
#endif
