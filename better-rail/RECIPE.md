# Better Rail

A 46px icon rail down the right edge of the Herdr window. It replaces the panel buttons in the tab bar: Files, Changes, and any other panel or mod command the layout lists.

## What you see

A narrow column at the window's right edge, `chrome` background with a `border` line on its left. 32px square icon buttons stack from the top, 4px apart, each with a tooltip. The active panel's button uses the `selected` background; the others stay muted and lighten on hover.

The Mod settings button sits at the bottom when Better Config is installed. It opens Better Config. Better Sidebar's footer no longer draws its own Mod settings button once Better Rail is present.

## How it behaves

- A panel button selects its stack child, shows the panel container, and highlights. Pressing it again hides the panel container.
- A command button runs its command, for example `mod.open` for Walkthrough or Automations.
- Better Tabs' `toolbar` setting chooses the mode. `rail` shows this column and hides the tab-bar buttons; `tab` hides the column and shows the tab-bar buttons.
- The column is the layout node with id `rail`; the mod shows or hides that node when the setting changes.

## Built from

- `mods/better-rail/mod.json`: `{ "place": "none", "title": "Better Rail" }`.
- `main.js`: one `View`, `v_flex`/`div`/`svg`, `layout()`, `run()`, `theme()`, `shared()`, `readTextFile()` and `appHome()`.
- `model.js`: `find`, `isActive`, `buttonsOf`, with no Herdr imports.
- The rail waits for `shared("better-tabs.toolbar")`. With no Better Tabs, it defaults to showing.

## Install

1. Copy `mods/better-rail/` into `~/.config/herdr-app/mods/better-rail/`.
2. Set Better Tabs' setting to rail. In `~/.config/herdr-app/mods/better-tabs/mod.json` add:

   ```json
   "settings": { "toolbar": "rail" }
   ```

   Better Config shows the same setting under Better Tabs. This is the setting the person can change back to `tab`.
3. Add the rail column as the last child of the layout's root row:

   ```json
   {
     "id": "rail",
     "type": "column",
     "size": { "px": 46 },
     "min": 46,
     "max": 46,
     "resizable": false,
     "background": "chrome",
     "children": [
       {
         "id": "better-rail",
         "type": "block",
         "size": { "weight": 1 },
         "content": {
           "mod": "better-rail",
           "props": {
             "buttons": [
               { "id": "files", "label": "Files", "icon": "mods/better-tabs/icons/file.svg", "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "files" } },
               { "id": "changes", "label": "Changes", "icon": "mods/better-tabs/icons/changes.svg", "action": { "type": "panel", "container": "panel", "stack": "panel-body", "target": "changes" } }
             ]
           }
         }
       },
       {
         "id": "rail-config",
         "type": "block",
         "size": { "px": 32 },
         "content": { "mod": "better-rail", "props": { "part": "config" } }
       }
     ]
   }
   ```

   Add every panel and command the person wants. The container and stack ids must match their layout. Give the buttons block `"size": { "weight": 1 }` so the config block stays at the bottom.
4. Empty Better Tabs' own toolbar so the icons are not in both places:

   ```json
   "buttons": []
   ```

   In a layout that uses Better Tabs, put this in the tabs block's `props`, or rely on the `toolbar: "rail"` setting, which hides the toolbar too.
5. Set the icon order in `~/.config/herdr-app/mods/better-rail/mod.json` if the person wants one. It is an array of button ids; ids left out keep their layout order:

   ```json
   "settings": { "order": ["files", "changes", "editor"] }
   ```

6. Run `herdr-app check ~/.config/herdr-app/mods/better-rail` and `herdr-app status`.

## Watch out

- The rail node id must be `rail`.
- Do not add a second docked `better-rail` block. Herdr can auto-dock a block the first time it sees a mod; remove that extra block and keep this column.
- Better Rail only knows about automatic Better Config detection through the file at `mods/better-config/mod.json`. Install Better Config if the person wants the bottom button.
- Better Sidebar checks for `mods/better-rail/mod.json`; do not rename the folder without changing that check.

## Done when

- The rail is at the right edge and the tab bar has no panel buttons.
- Clicking a panel icon opens it; clicking again closes it; the active icon is highlighted.
- Changing Better Tabs' `toolbar` setting to `tab` hides the rail and brings the tab-bar buttons back.
- Mod settings appears at the bottom of the rail and opens Better Config; it is gone from Better Sidebar's footer.
- `herdr-app check` passes and `herdr-app status` shows no mod errors.

## Uninstall

1. Set Better Tabs' `toolbar` setting back to `tab` in Better Config, or in `~/.config/herdr-app/mods/better-tabs/mod.json`.
2. Remove the `rail` column and its `rail-config` block from the layout.
3. Delete `~/.config/herdr-app/mods/better-rail/`.
4. Reload Herdr; Better Sidebar finds the folder gone and shows Mod settings in its footer again.

Leaving rail mode on while deleting the folder hides the tab-bar buttons and leaves an empty rail column.

## License

Apache-2.0.
