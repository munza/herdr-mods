# Better Rail

A right-edge icon rail for the panels and mods you already use, instead of a row of buttons in the tab bar.

![Better Rail](preview.png)

## Quick start

1. Install Better Rail, then set Better Tabs' `toolbar` setting to `rail`.
2. Click an icon to open its panel; click it again to close that panel.
3. Change the setting back to `tab` to return the buttons to the tab bar.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-rail

[RECIPE.md](RECIPE.md) guides the install. The rail is a layout block: the layout places a 46px column at the right edge, with the node id `rail`, and lists the buttons in `props.buttons`.

Better Rail copies the normal panel buttons into that block. A second 32px block at the bottom of the column draws the Mod settings button, which opens [Better Config](../better-config/README.md).

## Use

- **Panel buttons:** each selects its panel and shows the side dock. The active panel's button is highlighted; pressing it again hides the dock.
- **Command buttons:** each runs a command, such as `mod.open` for Walkthrough or Automations.
- **Switching modes:** Better Tabs owns the `toolbar` setting. `rail` hides the tab-bar buttons and shows the rail; `tab` hides the rail and shows the tab-bar buttons.
- **Mod settings:** the bottom button opens Better Config. Better Sidebar stops drawing its own Mod settings button while Better Rail is installed.

## Settings

Better Rail has one setting, the icon order:

| Key | Default | What it does |
| --- | --- | --- |
| `order` | `[]` | Button ids in the order to show them, such as `files, changes, editor`. Ids you leave out follow in the layout's order. |

Separately, Better Tabs' `toolbar` setting chooses the mode: `tab` keeps the panel buttons in the tab bar and hides the rail; `rail` hides the tab-bar buttons and shows the rail.

Better Config shows `order` under Better Rail as a list with each button's icon, name and ↑/↓ controls; changes save at once. By hand, add the two settings to the installed mods:

```json
"settings": { "order": ["files", "changes", "editor"] }
```

```json
"settings": { "toolbar": "rail" }
```

## Update

Copy `mods/better-rail/` into `~/.config/herdr-app/mods/better-rail/` again, or ask your agent to. The layout and Better Tabs' setting stay as they are.

## Uninstall

1. In Better Config → Better Tabs, set `toolbar` to `tab`. The panel buttons return to the tab bar and the rail hides.
2. Remove the layout's `rail` column, including its `rail-config` block.
3. Delete `~/.config/herdr-app/mods/better-rail/`.
4. Reload Herdr or switch layouts. Better Sidebar sees the folder is gone and puts Mod settings back in its footer.

Do not delete the folder while rail mode is still on: the tab-bar buttons stay hidden and the empty rail column remains.

## For developers

- `props.buttons` is the layout's list: `{ id, label, icon, action }`.
- A `panel` action is `{ type: "panel", container, stack, target }`; pressing it selects and shows that panel, or hides the container when it is already active.
- A `command` action is `{ type: "command", name, args }`; pressing it runs the same command a key would.
- Better Tabs publishes `better-tabs.toolbar` in shared state. The rail shows itself for `rail`, and hides the layout node `rail` for `tab`.
- The bottom block uses `props.part: "config"` and opens Better Config.
- `order` lists button ids; unlisted buttons keep their layout order after the listed ones.
- `main.js` draws and acts; `model.js` has the layout lookup, active check, button filter and order, with no Herdr imports.

```sh
./sync.sh
herdr-app check mods/better-rail
node --test tests/*.test.cjs
```

## License

Apache-2.0.
