import AppKit
import ServiceManagement
import SwiftUI

@main
struct DashboardStatusApp: App {
    @StateObject private var model = StatusModel()

    var body: some Scene {
        MenuBarExtra {
            StatusMenu(model: model)
        } label: {
            Image(nsImage: statusIcon(model.overall))
        }
        .menuBarExtraStyle(.menu)
    }
}

// Colored (non-template) dot so the status is readable at a glance in light and dark menu bars
private func statusIcon(_ status: Status) -> NSImage {
    let name = status == .unknown ? "circle.dashed" : "circle.fill"
    let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
        .applying(NSImage.SymbolConfiguration(paletteColors: [status.color]))
    let image = NSImage(systemSymbolName: name, accessibilityDescription: "Dashboard \(status.label)")!
        .withSymbolConfiguration(config)!
    image.isTemplate = false
    return image
}

private struct StatusMenu: View {
    @ObservedObject var model: StatusModel
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Text("Formlabs Dashboard: \(model.overall.label)")

        if let error = model.fetchError {
            Text(error)
        } else if let summary = model.summary {
            if summary.stale {
                Text("Status data is stale — checker may be down")
            }
            ForEach(summary.checks) { check in
                Text(checkLine(check))
            }
            if let lastRun = summary.lastRun {
                Text("Checked \(relative(Date(timeIntervalSince1970: lastRun / 1000)))")
            }
        } else {
            Text("Loading…")
        }

        Divider()
        Button("Open Status Page") { NSWorkspace.shared.open(model.baseURL) }
        Button("Open Dashboard") { NSWorkspace.shared.open(URL(string: "https://dashboard.formlabs.com/")!) }
        Button("Refresh Now") { Task { await model.refresh() } }
            .keyboardShortcut("r")
        Divider()
        Toggle("Launch at Login", isOn: $launchAtLogin)
            .onChange(of: launchAtLogin) { enabled in
                do {
                    if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                } catch {
                    launchAtLogin = SMAppService.mainApp.status == .enabled
                }
            }
        Button("Quit") { NSApplication.shared.terminate(nil) }
            .keyboardShortcut("q")
    }

    private func checkLine(_ check: Check) -> String {
        let dot = switch check.status {
        case .up: "🟢"
        case .degraded: "🟡"
        case .down: "🔴"
        case .unknown: "⚪️"
        }
        var line = "\(dot)  \(check.name) — \(check.status.label)"
        if check.status == .down, let error = check.error {
            line += " (\(error))"
        } else if let ms = check.ms {
            line += " · \(ms) ms"
        }
        return line
    }

    private func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
