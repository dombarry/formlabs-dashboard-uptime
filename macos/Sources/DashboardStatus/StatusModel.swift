import AppKit
import Foundation
import UserNotifications

enum Status: String, Decodable {
    case up, degraded, down, unknown

    var label: String {
        switch self {
        case .up: "Operational"
        case .degraded: "Slow"
        case .down: "Down"
        case .unknown: "Unknown"
        }
    }

    var color: NSColor {
        switch self {
        case .up: .systemGreen
        case .degraded: .systemYellow
        case .down: .systemRed
        case .unknown: .systemGray
        }
    }

    // Falls back to unknown if the server adds a status this build doesn't know about
    init(from decoder: Decoder) throws {
        self = Status(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

struct Check: Decodable, Identifiable {
    let id: String
    let name: String
    let status: Status
    let ms: Int?
    let error: String?
}

struct Summary: Decodable {
    let overall: Status
    let lastRun: Double?
    let stale: Bool
    let checks: [Check]
}

@MainActor
final class StatusModel: ObservableObject {
    @Published private(set) var summary: Summary?
    @Published private(set) var fetchError: String?
    @Published private(set) var lastFetched: Date?

    private static let pollInterval: TimeInterval = 60
    private var timer: Timer?
    private var lastNotified: Status?
    private let notificationsAvailable = Bundle.main.bundleIdentifier != nil

    // Status page base URL: `defaults write com.formlabs.dashboard-status statusPageURL <url>`
    // overrides the one baked into Info.plist at build time
    let baseURL: URL = {
        let raw = UserDefaults.standard.string(forKey: "statusPageURL")
            ?? Bundle.main.object(forInfoDictionaryKey: "StatusPageURL") as? String
            ?? "https://formlabs-dashboard-uptime.vercel.app"
        return URL(string: raw.trimmingCharacters(in: CharacterSet(charactersIn: "/")))!
    }()

    var overall: Status {
        if fetchError != nil { return .unknown }
        return summary?.overall ?? .unknown
    }

    init() {
        if notificationsAvailable {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    func refresh() async {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/status"))
        request.timeoutInterval = 15
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            summary = try JSONDecoder().decode(Summary.self, from: data)
            fetchError = nil
        } catch {
            fetchError = "Can't reach the status server"
        }
        lastFetched = Date()
        notifyIfChanged()
    }

    // Only notify on real up <-> down transitions, not on the first load or on our own network blips
    private func notifyIfChanged() {
        let current = overall
        guard current != .unknown else { return }
        defer { lastNotified = current }
        guard let previous = lastNotified, previous != current, notificationsAvailable else { return }

        let content = UNMutableNotificationContent()
        switch (previous, current) {
        case (_, .down):
            let failing = summary?.checks.filter { $0.status == .down }.map(\.name).joined(separator: ", ") ?? ""
            content.title = "Formlabs Dashboard is down"
            content.body = failing.isEmpty ? "One or more checks are failing." : "Failing: \(failing)"
        case (.down, _):
            content.title = "Formlabs Dashboard recovered"
            content.body = "All checks are passing again."
        default:
            return
        }
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }
}
