# Better Alerts

System notifications for [Herdr Desktop](https://herdr.dev/) on macOS and Linux: when an agent needs you, or finishes while you're looking elsewhere, your desktop says so, with what it asked or what it did, even with Herdr behind another window. Click the notification to open that agent.

![Better Alerts](preview.png)

## Quick start

1. Install with the prompt below. On macOS, let the agent build the notifier that gives alerts Herdr's icon and the click.
2. Give an agent a task, then switch to another app. When it asks for permission or finishes, a notification comes up; click it to go straight to that agent.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-alerts

[RECIPE.md](RECIPE.md) guides the install. It draws nothing, so the agent runs it as an empty floating block in a layout you own:

```json
"floating": [{ "id": "better-alerts", "content": { "mod": "better-alerts" }, "edge": "bottom", "align": "end" }]
```

It reads the agent's screen with `hc read` for its question or reply, runs `herdr-app do agent.focus` on a click, and reaches no network. On Windows it does nothing.

- **macOS:** the agent builds `HerdrAlerts.app`, a small notifier, into the mod's `bin/` with `helper/build.sh`. It needs Xcode's Command Line Tools (`xcode-select --install`) for `swiftc`. Its notifications carry Herdr's name and icon, and a click opens the agent and brings Herdr forward. The first one may ask you to allow notifications from Herdr. Until it's built, alerts come through `osascript`, with Script Editor's icon, and a click opens Script Editor.
- **Linux:** it needs `notify-send`, from libnotify, and a notification daemon such as mako, dunst or GNOME's. On Hyprland, `hyprctl` brings Herdr forward on a click.

<details>
<summary>Install by hand</summary>

From a clone of the repository, `sync.sh` copies `mods/better-alerts/` into Herdr's mods folder, and on macOS `helper/build.sh` builds the notifier into it. Then add the floating block above to your layout.

```sh
./better-alerts/sync.sh
./better-alerts/helper/build.sh    # macOS only
```

</details>

## Use

- **Needs you:** an agent asks for input or permission.
- **Finished:** an agent that was working is done, and you weren't looking at it: Herdr was in the background, or another tab was shown.
- **Click** a notification (on Linux, its Open action) and Herdr shows that agent and comes to the front.
- **What it says:** the title is whose, in which space, and its status, like `Claude Code / lantern-app - NEEDS YOU` or `Codex / trail-notes - DONE`. Under it is the tab, like `Fix the login form`. Then the message: the question an agent that needs you is asking, like `Do you want to make this edit to login.js?`, or how a finished agent's last reply began, cut to about two lines.
- A tab named like its space, or only by its number, is left out. When the screen holds no question or reply, the message is left out.
- On macOS, the alerts from one agent stack together in Notification Centre.
- Sub-agents stay quiet; their parent speaks for them. Agents already waiting when Herdr starts don't post.
- Herdr's own in-app toasts are unchanged.

## Limits

- **The message is read from the screen.** The question is the lowest line ending in `?`; the reply is the agent's last one, from Claude Code's `⏺` or Codex's `•` marker, else the last paragraph above the prompt. An agent that draws its screen differently may show a line from its status bar, or nothing.
- **macOS without the notifier** gets alerts with Script Editor's icon, and a click opens Script Editor, not the agent. Build it with `helper/build.sh`.
- **macOS remembers a refusal.** If you said no to Herdr's notifications, or macOS refused them, alerts come through `osascript` instead, with Script Editor's icon. Allow **Herdr** in System Settings → Notifications to get the icon and the click back. macOS also refuses an app in a temporary folder, so build the notifier where `build.sh` puts it.
- On Linux, only Hyprland gets the window brought forward on a click; elsewhere Herdr shows the agent but may stay behind other windows.
- Windows isn't supported yet.
- It checks twice a second, so a notification can come up to half a second after the change.

## Settings

[Better Config](../better-config/README.md) shows these with what each one does, and changes, checks and resets them for you. By hand, add a `settings` block to the installed `mods/better-alerts/mod.json` with only what you change, such as `"settings": { "alerts": { "done": false } }`.

| Key | Default | What it does |
| --- | --- | --- |
| `alerts.blocked` | `true` | A notification when an agent needs you. `false` stops the needs-you notifications. |
| `alerts.done` | `true` | A notification when an agent finishes while you aren't looking at it. `false` stops the finished ones. |

## Update

Copy `mods/better-alerts/` into Herdr again, keeping its `bin/`; Herdr reloads it. On macOS, run `helper/build.sh` again when the notifier changed. Your settings in the installed `mod.json` are replaced, and [Better Config](../better-config/README.md) offers to restore them.

## For developers

Every 500ms it compares each agent's status with the last look, reads the screen of one that changed, and posts. `mods/better-alerts/words.js` holds what a notification says and touches nothing in Herdr, so the tests run it as it is. On Linux it posts through a detached shell, so `exec` answers at once and a click still works later; on macOS through `helper/`, a Swift app that macOS relaunches for a click. [RECIPE.md](RECIPE.md) has the details.

```sh
node --test tests/*.test.cjs
./sync.sh            # copies mods/better-alerts/ into Herdr
./helper/build.sh    # macOS: builds HerdrAlerts.app into it
herdr-app check "$HOME/.config/herdr-app/mods/better-alerts"
```
