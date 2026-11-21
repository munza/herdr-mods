# Better Tabs

A tab bar for [Herdr Desktop](https://herdr.dev/): tabs you can drag, that wrap onto more lines when they don't fit and name themselves after what runs in them, and a toolbar for your panels with a ⋮ menu to tuck away the ones you rarely use.

![Better Tabs in Herdr](preview.png)

## Quick start

1. Install with the prompt below. It takes the place of your tab bar.
2. Press and hold a tab, then drag it to reorder. Open enough tabs and they wrap onto a second line.
3. Drag a panel button onto ⋮ to hide it; click ⋮ and the pin to bring it back.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-tabs

Follow [RECIPE.md](RECIPE.md). The agent copies `mods/better-tabs/` into the app configuration. The manifest uses `"place": "none"` and Herdr's shipped layouts are read-only, so the mod only shows in a layout you own: the agent points the tabs block there at `better-tabs`, keeping its size and `window_drag`. The mod installs no key bindings.

No requirements. The mod runs no programs and reaches no network. It runs Herdr commands and keeps its preferences in Herdr's shared state.

## Use

- **Drag tabs** to reorder them. A separate line in the gap between tabs shows where the tab will land. Dropping on **+** puts it last; leaving the bar cancels.
- **Quick clicks never drag:** a drag starts only once a press has lasted 400ms (`tabs.drag_delay`) and the pointer has moved 12px.
- **Tabs wrap** onto more lines, and the bar grows to hold them, then shrinks back as tabs close.
- The **+** sits right after the last tab.
- **Scroll over the bar** to switch tabs. Wheel notches switch once each; touchpad gestures switch in steps.
- Double-click to rename, right-click for the tab menu, and close the active tab with its ×.
- **Tabs name themselves** and keep up: an agent by its useful live title, or its name when the title is generic; a shell by its folder; another program by its name (Neovim). Your own names stay, and renaming a tab to nothing hands it back.
- Program icons, a spinner while working, and a dot when blocked or done.
- **Drag panel buttons** (Files, Changes and any you add) to reorder them, the same way.
- **The ⋮ menu:** drop a panel button on it to hide it. Click **⋮** to see hidden buttons, then click one to use it, drag it back out, or click its **pin** to return it to the toolbar. The menu also holds buttons there's no room for.
- Each space remembers which panel it had open.
- Window controls where the system needs them.

## Settings

[Better Config](../better-config/README.md) shows these with what each one does, and changes, checks and resets them for you. By hand, add a `settings` block to the installed `~/.config/herdr-app/mods/better-tabs/mod.json` with only what you change, such as `"settings": { "tabs": { "auto_name": false } }`. `mod.schema.json` beside it describes every setting, so an editor that reads `$schema`, such as VS Code or Zed, checks the block as you type.

| Key | Default | What it does |
| --- | --- | --- |
| `tabs.max_width` | `170` | The widest a tab gets, in px. At least 60. |
| `tabs.drag_delay` | `400ms` | How long a press must last before a tab can be dragged. |
| `tabs.auto_name` | `true` | Tabs name themselves after what runs in them. `false` turns it off. |
| `menu.width` | `240` | The width of the ⋮ menu, in px. At least 120. |

## Update

Copy `mods/better-tabs/` into `~/.config/herdr-app/mods/` again, or ask your agent to. This replaces `mod.json`, so copy your `settings` block forward, or let [Better Config](../better-config/README.md) notice the reset and offer to restore each value. Your toolbar arrangement lives in shared state, not the mod folder, so it stays.

<details>
<summary>Upgrading from 2.x</summary>

3.0 removed options nothing used: `hooks.js`, buttons from other mods (`contributions`), the `mod-tab`, `overlay`, `toggle-stack`, `sequence`, `shared` and `hook` actions, badges, the `enabledWhen`, `activeWhen` and `disabled` conditions, `iconOnly`, `order`, `overflow`, `maxButtons`, `toolbarId`, `commands`, `modIcons`, `tabMaxWidth`, `closeButtons`, `programIcons`, `statusIndicators`, `newButton`, `sidebar` and mouse-wheel tab switching. Tabs now wrap instead of scrolling. Version 3.3 restores wheel switching over the bar without changing the wrapping layout.

</details>

## For developers

### Toolbar buttons

Without configuration, the toolbar offers Files and Changes when those layout nodes exist. To choose the buttons, set `props` on the tabs block. Your list replaces the defaults.

```json
{
  "mod": "better-tabs",
  "props": {
    "rememberPanels": { "container": "panel", "stack": "panel-body" },
    "buttons": [
      {
        "id": "changes",
        "label": "Changes",
        "icon": "changes",
        "group": "panels",
        "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "changes" }
      },
      {
        "id": "palette",
        "label": "Commands",
        "group": "tools",
        "action": { "type": "command", "name": "app.palette" }
      }
    ]
  }
}
```

| Button field | Required | What it does |
| --- | --- | --- |
| `id` | Yes | Unique. The arrangement is saved by it. |
| `action` | Yes | `panel` shows or hides a panel by layout node ID (`container`, `stack`, `target`), or `command` runs an app or mod command (`name`, optional `args`). |
| `label` | No | Defaults to the ID. |
| `icon` | No | A bundled name (`file`, `changes`) or an SVG path from the Herdr home, like `mods/my-panel/icon.svg`. |
| `tooltip` | No | Hover text. |
| `group` | No | A separator appears where the group changes. |
| `when` | No | `{ "node": "changes" }` shows the button only while that layout node exists and isn't hidden. |

`rememberPanels` names the panel container and stack for per-space panel memory; `rememberPanels: false` turns it off.

Your arrangement is saved per layout, by button ID, in shared state, and doesn't edit the layout file.

### Commands

Bind them in `keys.json` if you like; the mod installs no keys.

```sh
herdr-app do better-tabs.button:changes   # run a button by ID
herdr-app do better-tabs.overflow         # open the ⋮ menu
```

### Icons from other mods

A mod's tab shows the icon it publishes in the `mod-icons` shared map. [Better Changes](../better-changes/README.md) does this. A tab whose pane publishes its own icon in `pane-heads`, as a [Better Files](../better-files/README.md) or Better Changes file tab does, shows that icon instead.

### Work on the mod

In `mods/better-tabs/`:

- `main.js`: setup, settings and commands. `settings.js`: shared with the other mods.
- `actions/engine.js`: what a button does. `actions/toolbar.js`: arrangement and tab-move logic with no drawing. `actions/names.js`: auto names.
- `views/tab-bar.js`: the bar. `views/menu.js`: buttons and the ⋮ menu. `views/drags.js`: dragging. `views/arrangement.js`: saved order. `views/panel-memory.js`: panels per space. `views/ui.js`: the design kit.
- `icons/`: this mod's icons.

Beside it:

- `sync.sh`: copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.
- `tests/tabs.test.cjs`: the tests.

```sh
node --test tests/*.test.cjs
herdr-app check "$PWD/mods/better-tabs"
```

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
