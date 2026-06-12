import Foundation

// typora-plugin-daemon
// 监控 Typora 版本变化，版本变更时自动触发插件重注入。
// 仅支持 Apple Silicon (arm64)，macOS 13+。

let TYPORA_APP_PATH = "/Applications/Typora.app"
let INFO_PLIST = "\(TYPORA_APP_PATH)/Contents/Info.plist"
let VERSION_DEFAULTS_KEY = "com.typora.plugin.LastKnownTyporaVersion"
let REINSTALL_SCRIPT = "/usr/local/bin/typora-plugin-reinstall.sh"
let CHECK_INTERVAL: TimeInterval = 6 * 60 * 60  // 6 小时

func log(_ message: String) {
    let formatter = ISO8601DateFormatter()
    let ts = formatter.string(from: Date())
    FileHandle.standardError.write("[\(ts)] \(message)\n".data(using: .utf8)!)
}

func currentTyporaVersion() -> String? {
    guard let dict = NSDictionary(contentsOfFile: INFO_PLIST) else {
        return nil
    }
    return dict["CFBundleShortVersionString"] as? String
}

func lastKnownVersion() -> String? {
    UserDefaults.standard.string(forKey: VERSION_DEFAULTS_KEY)
}

func saveVersion(_ version: String) {
    UserDefaults.standard.set(version, forKey: VERSION_DEFAULTS_KEY)
}

func triggerReinject() {
    guard FileManager.default.fileExists(atPath: REINSTALL_SCRIPT) else {
        log("ERROR: reinstall script not found at \(REINSTALL_SCRIPT)")
        return
    }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/bash")
    task.arguments = [REINSTALL_SCRIPT]
    do {
        try task.run()
        task.waitUntilExit()
        log("Reinject finished with status \(task.terminationStatus)")
    } catch {
        log("ERROR: failed to run reinstall script: \(error)")
    }
}

func checkOnce() {
    guard let current = currentTyporaVersion() else {
        log("Typora not found or Info.plist unreadable, skipping")
        return
    }
    let last = lastKnownVersion()
    if last == nil {
        // 首次运行：记录当前版本，不重注入（安装脚本已注入）
        log("First run, recording version \(current)")
        saveVersion(current)
        return
    }
    if current != last {
        log("Typora version changed: \(last!) -> \(current), reinjecting")
        triggerReinject()
        saveVersion(current)
    } else {
        log("Typora version unchanged (\(current))")
    }
}

log("typora-plugin-daemon started (interval \(Int(CHECK_INTERVAL))s)")
checkOnce()
while true {
    Thread.sleep(forTimeInterval: CHECK_INTERVAL)
    checkOnce()
}
