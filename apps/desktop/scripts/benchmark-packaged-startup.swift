import AppKit
import CoreGraphics
import Darwin
import Foundation

private let startupBudgetMilliseconds = 3_000.0
private let rssBudgetBytes = UInt64(512 * 1024 * 1024)
private let sampleCount = 5
private let settledDelaySeconds = 3.0

private struct Sample: Codable {
    let startupMilliseconds: Double
    let settledRssBytes: UInt64
}

private struct Report: Codable {
    let application: String
    let bundleIdentifier: String
    let samples: [Sample]
    let startupP50Milliseconds: Double
    let startupP95Milliseconds: Double
    let settledRssP50Bytes: UInt64
    let settledRssP95Bytes: UInt64
    let startupBudgetMilliseconds: Double
    let rssBudgetBytes: UInt64
}

private enum BenchmarkError: Error, CustomStringConvertible {
    case invalidArguments
    case invalidBundle
    case alreadyRunning
    case processExited
    case windowTimeout
    case metricUnavailable
    case budgetExceeded

    var description: String {
        switch self {
        case .invalidArguments: return "usage: swift benchmark-packaged-startup.swift <QA.app>"
        case .invalidBundle: return "benchmark_requires_a_packaged_editing_qa_app"
        case .alreadyRunning: return "benchmark_app_already_running"
        case .processExited: return "benchmark_app_exited_before_window"
        case .windowTimeout: return "benchmark_visible_window_timeout"
        case .metricUnavailable: return "benchmark_process_metric_unavailable"
        case .budgetExceeded: return "benchmark_budget_exceeded"
        }
    }
}

private func elapsedMilliseconds(since start: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000.0
}

private func hasVisibleWindow(processIdentifier: Int32) -> Bool {
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else { return false }
    return windows.contains { window in
        let owner = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
        let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue
        return owner == processIdentifier && layer == 0
    }
}

private func settledResidentBytes(
    processIdentifier: Int32, bundleIdentifier: String
) throws -> UInt64 {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-axo", "pid=,rss=,command="]
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw BenchmarkError.metricUnavailable }
    guard let text = String(data: data, encoding: .utf8) else {
        throw BenchmarkError.metricUnavailable
    }
    var totalKilobytes = UInt64(0)
    for line in text.split(separator: "\n") {
        let fields = line.split(maxSplits: 2, whereSeparator: { $0.isWhitespace })
        guard fields.count == 3, let pid = Int32(fields[0]), let rss = UInt64(fields[1]) else {
            continue
        }
        if pid == processIdentifier || fields[2].contains(bundleIdentifier) {
            totalKilobytes += rss
        }
    }
    guard totalKilobytes > 0 else { throw BenchmarkError.metricUnavailable }
    return totalKilobytes * 1024
}

private func percentile<T>(_ sorted: [T], fraction: Double) -> T {
    let index = min(sorted.count - 1, max(0, Int(ceil(Double(sorted.count) * fraction)) - 1))
    return sorted[index]
}

private func stop(_ process: Process) {
    guard process.isRunning else { return }
    process.terminate()
    let deadline = Date().addingTimeInterval(0.5)
    while process.isRunning && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    if process.isRunning {
        Darwin.kill(process.processIdentifier, SIGKILL)
    }
    process.waitUntilExit()
}

private func run() throws {
    guard CommandLine.arguments.count == 2 else { throw BenchmarkError.invalidArguments }
    let applicationURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
    guard let bundle = Bundle(url: applicationURL),
          let bundleIdentifier = bundle.bundleIdentifier,
          bundleIdentifier.hasSuffix(".editing-qa"),
          let executableURL = bundle.executableURL else {
        throw BenchmarkError.invalidBundle
    }
    guard NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty else {
        throw BenchmarkError.alreadyRunning
    }

    var samples = [Sample]()
    for _ in 0..<sampleCount {
        let application = Process()
        application.executableURL = executableURL
        application.standardOutput = FileHandle.nullDevice
        application.standardError = FileHandle.nullDevice
        let started = DispatchTime.now()
        try application.run()
        var visible = false
        while elapsedMilliseconds(since: started) < 10_000 {
            guard application.isRunning else { throw BenchmarkError.processExited }
            if hasVisibleWindow(processIdentifier: application.processIdentifier) {
                visible = true
                break
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        do {
            guard visible else { throw BenchmarkError.windowTimeout }
            let startupMilliseconds = elapsedMilliseconds(since: started)
            Thread.sleep(forTimeInterval: settledDelaySeconds)
            let settledRssBytes = try settledResidentBytes(
                processIdentifier: application.processIdentifier, bundleIdentifier: bundleIdentifier
            )
            samples.append(Sample(
                startupMilliseconds: startupMilliseconds, settledRssBytes: settledRssBytes
            ))
        } catch {
            stop(application)
            throw error
        }
        stop(application)
        Thread.sleep(forTimeInterval: 0.5)
    }

    let startup = samples.map(\.startupMilliseconds).sorted()
    let rss = samples.map(\.settledRssBytes).sorted()
    let report = Report(
        application: applicationURL.path,
        bundleIdentifier: bundleIdentifier,
        samples: samples,
        startupP50Milliseconds: percentile(startup, fraction: 0.50),
        startupP95Milliseconds: percentile(startup, fraction: 0.95),
        settledRssP50Bytes: percentile(rss, fraction: 0.50),
        settledRssP95Bytes: percentile(rss, fraction: 0.95),
        startupBudgetMilliseconds: startupBudgetMilliseconds,
        rssBudgetBytes: rssBudgetBytes
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(report))
    FileHandle.standardOutput.write(Data("\n".utf8))
    if report.startupP95Milliseconds > startupBudgetMilliseconds
        || report.settledRssP95Bytes > rssBudgetBytes {
        throw BenchmarkError.budgetExceeded
    }
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("PACKAGED_STARTUP_BENCHMARK_ERROR \(error)\n".utf8))
    exit(1)
}
