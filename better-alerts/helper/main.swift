// HerdrAlerts: Better Alerts' notifications on macOS. It posts one notification with Herdr's
// icon and quits; a click on it, even after it quit, has macOS launch it again, and it shows
// that agent and brings Herdr forward.
//
//   HerdrAlerts post <title> <subtitle> <body> <agent.focus arguments> [herdr-app path]
//
// The subtitle says where the agent is, the body what it asked or said. Alerts from one agent
// stack together in Notification Centre.
//
// Better Alerts runs it with `open -g -n HerdrAlerts.app --args post …`: macOS only lets an app
// it launched itself ask to post.
import AppKit
import UserNotifications

let herdrBundle = "dev.herdr.app"
// Where herdr-app is usually linked, for when Better Alerts couldn't find it on its PATH.
let herdrPlaces = ["/opt/homebrew/bin/herdr-app", "/usr/local/bin/herdr-app", NSHomeDirectory() + "/.local/bin/herdr-app"]
// How long a launch with no arguments waits for macOS to hand over the click.
let clickWait = 10.0

// A notification without Herdr's icon or the click, for when macOS won't let this app post.
func plain(title: String, subtitle: String, body: String) {
  let run = Process()
  run.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  run.arguments = ["-e", "on run argv", "-e", "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
                   "-e", "end run", title, subtitle, body]
  guard (try? run.run()) != nil else { return }
  run.waitUntilExit()
}

func fail(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write("HerdrAlerts: \(message)\n".data(using: .utf8)!)
  exit(code)
}

final class Alerts: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let center = UNUserNotificationCenter.current()

  // The delegate has to be in place before launch finishes, or a click that launched it is lost.
  func applicationWillFinishLaunching(_ note: Notification) {
    center.delegate = self
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    let args = Array(CommandLine.arguments.dropFirst())
    if args.first == "post" {
      guard args.count >= 5 else { fail("usage: post <title> <subtitle> <body> <agent.focus arguments> [herdr-app]", 64) }
      post(title: args[1], subtitle: args[2], body: args[3], target: args[4], herdr: args.count > 5 ? args[5] : "")
    } else {
      DispatchQueue.main.asyncAfter(deadline: .now() + clickWait) { exit(0) }
    }
  }

  func post(title: String, subtitle: String, body: String, target: String, herdr: String) {
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
      guard granted else {
        // Refused, now or once before (macOS remembers): post through osascript instead, so the
        // alert isn't lost, and say where to allow it.
        plain(title: title, subtitle: subtitle, body: body)
        fail("not allowed to post (\(error?.localizedDescription ?? "turned off")); allow Herdr in System Settings > Notifications", 2)
      }
      let content = UNMutableNotificationContent()
      content.title = title
      content.subtitle = subtitle
      content.body = body
      content.threadIdentifier = target
      content.userInfo = ["target": target, "herdr": herdr]
      let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
      self.center.add(request) { error in
        if let error { fail("couldn't post: \(error.localizedDescription)", 1) }
        exit(0)
      }
    }
  }

  // Herdr is in front when the person is looking at it, and macOS would hide the banner then.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .list])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    done()
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
          let target = info["target"] as? String else { exit(0) }
    focus(target, herdr: info["herdr"] as? String ?? "")
    guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: herdrBundle) else { exit(0) }
    let open = NSWorkspace.OpenConfiguration()
    open.activates = true
    NSWorkspace.shared.openApplication(at: app, configuration: open) { _, _ in exit(0) }
  }

  // herdr-app do agent.focus <target>, so Herdr shows the agent before it comes forward.
  func focus(_ target: String, herdr: String) {
    let path = ([herdr] + herdrPlaces).first { !$0.isEmpty && FileManager.default.isExecutableFile(atPath: $0) }
    guard let path else { return }
    let run = Process()
    run.executableURL = URL(fileURLWithPath: path)
    run.arguments = ["do", "agent.focus", target]
    guard (try? run.run()) != nil else { return }
    run.waitUntilExit()
  }
}

let app = NSApplication.shared
let alerts = Alerts()
app.delegate = alerts
app.setActivationPolicy(.accessory)
app.run()
