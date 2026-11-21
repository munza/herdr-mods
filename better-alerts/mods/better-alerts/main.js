// Better Alerts: a system notification when an agent needs you, or finishes while you aren't
// looking at it, saying what it asked or how its reply began. Clicking one opens that agent and
// brings Herdr forward. On Linux it hands the notification to notify-send; on macOS to its own
// HerdrAlerts.app, or osascript until that's built. It draws nothing, so a layout runs it as an
// empty floating block, and it never runs a program from render.
import { View, div } from "gpui-kit";
import { agents, appHome, checking, exec, focused, hc, setBadge, terminals, window } from "herdr";
import { loadSettings } from "./settings.js";
import { alert, escapeMarkup } from "./words.js";

// Preferences a person may change in the installed mod.json under `settings`.
const DEFAULT_SETTINGS = { alerts: { blocked: true, done: true } };

const BUSY = new Set(["working", "blocked"]);
const CHECK_MS = 500;
// How much of an agent's screen and history is read for its question or reply.
const SCREEN_LINES = 80;

// Linux. Detached, with its output closed, so exec answers at once and a click still works
// after exec's 30-second limit.
const DETACH = `setsid -f sh -c "$1" sh "$2" "$3" "$4" >/dev/null 2>&1 </dev/null`;

// $1 the title, $2 the body, $3 the agent.focus arguments. Hyprland 0.56's Lua config takes
// only the first focus form, older Hyprland only the second.
const SCRIPT = `
action=$(notify-send -a Herdr -i herdr-app -A default=Open -- "$1" "$2")
[ "$action" = default ] || exit 0
herdr-app do agent.focus "$3"
command -v hyprctl >/dev/null || exit 0
hyprctl dispatch 'hl.dsp.focus({ window = "class:^(herdr-app)$" })' >/dev/null 2>&1 ||
  hyprctl dispatch focuswindow 'class:^(herdr-app)$' >/dev/null 2>&1
`;

// macOS. $1 HerdrAlerts.app, $2 the title, $3 the tab, $4 the message, $5 the agent.focus
// arguments. open returns once the app is launched, and macOS lets only an app it launched ask
// to post. Without the app, osascript posts the same words, with no icon and no click.
const MAC_SCRIPT = `
herdr=$(command -v herdr-app || true)
[ -d "$1" ] && exec open -g -n "$1" --args post "$2" "$3" "$4" "$5" "$herdr"
exec osascript -e 'on run argv' -e 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)' -e 'end run' "$2" "$3" "$4"
`;

// You're looking at an agent when Herdr is the active window and its tab is the shown one.
function looking(agent) {
  if (!window()?.active) return false;
  return focused()?.tab === agent.tab;
}

class BetterAlerts extends View {
  init(_props, cx) {
    if (checking()) return;
    this.settings = DEFAULT_SETTINGS;
    this.warned = false;
    this.platform = window()?.platform;
    if (this.platform !== "linux" && this.platform !== "macos") return;
    const current = agents();
    this.seen = new Map(current.map((a) => [a.address, a.status]));
    this.updateBadge(current, new Set(terminals().filter((t) => t?.parent).map((t) => t.address)));
    this.helper = `${appHome()}/mods/better-alerts/bin/HerdrAlerts.app`;
    cx.spawn(async (cx) => {
      const { settings, problems } = await loadSettings("better-alerts", DEFAULT_SETTINGS);
      this.settings = settings;
      for (const problem of problems) console.warn(`better-alerts mod.json settings: ${problem}`);
      cx.notify();
    });
    cx.timer.every(CHECK_MS, () => this.check());
  }

  // Posts for each agent whose status changed since the last look, including a new agent's
  // first one. Agents already there when it starts count as seen, and a sub-agent posts
  // nothing, since its parent speaks for it.
  check() {
    const current = agents();
    const subAgents = new Set(terminals().filter((t) => t?.parent).map((t) => t.address));
    this.updateBadge(current, subAgents);
    const live = new Set();
    for (const a of current) {
      live.add(a.address);
      const before = this.seen.get(a.address);
      this.seen.set(a.address, a.status);
      if (before === a.status || subAgents.has(a.address)) continue;
      // Only needs-you and finished have a setting, so this also skips every other status.
      if (!this.settings.alerts[a.status]) continue;
      if (a.status === "done" && (!BUSY.has(before) || looking(a))) continue;
      this.post(a);
    }
    for (const address of this.seen.keys()) if (!live.has(address)) this.seen.delete(address);
  }

  updateBadge(current, subAgents) {
    if (this.platform !== "macos") return;
    const blocked = current.filter((a) => a.status === "blocked" && !subAgents.has(a.address)).length;
    const badge = blocked ? String(blocked) : null;
    if (badge === this.badge) return;
    this.badge = badge;
    setBadge(badge);
  }

  // The agent's screen and recent history, or nothing when it can't be read.
  async screen(address) {
    try {
      const read = await hc(["read", address, "--lines", String(SCREEN_LINES)]);
      return read?.code === 0 ? read.stdout : "";
    } catch {
      return "";
    }
  }

  async post(agent) {
    const said = alert(agent, await this.screen(agent.address));
    const target = JSON.stringify({ terminal: agent.address });
    const args = this.platform === "macos"
      ? ["-c", MAC_SCRIPT, "sh", this.helper, said.title, said.tab, said.message, target]
      : ["-c", DETACH, "sh", SCRIPT, said.title, escapeMarkup(said.body), target];
    try {
      await exec("sh", args);
    } catch (error) {
      if (this.warned) return;
      this.warned = true;
      console.warn(`better-alerts: couldn't post a notification: ${error}`);
    }
  }

  render() {
    return div();
  }
}

export default BetterAlerts;
