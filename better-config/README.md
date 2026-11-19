# Better Config

Every installed mod's settings in one dialog for [Herdr Desktop](https://herdr.dev/), drawn like Herdr's own Settings, and a list of the mods you have. It checks values before saving, writes only what you changed, and offers to restore your changes after an update.

![Better Config in Herdr](preview.png)

## Quick start

1. Install with the prompt below and say yes to the suggested key, **⌘⌥,**.
2. Press the key and pick a mod from the list. Change a setting: it's checked, saved and applied at once.
3. A dot marks what you changed. After a mod updates, a box at the top offers to restore your values.

## Install

Copy this prompt into your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/munza/herdr-mods/tree/main/better-config

[RECIPE.md](RECIPE.md) guides the install. It's a dialog, so it needs no place in a layout. The agent never overwrites an unrelated mod with the same name, and merges the suggested key into your `keys.json` only if you agree.

<details>
<summary>Install by hand</summary>

To install by hand from a clone of the repository, `sync.sh` copies `mods/better-config/` into Herdr's mods folder:

```sh
./better-config/sync.sh
```

</details>

### Open it

Herdr's command palette doesn't list mods, so give it a key. [keys.json](keys.json) suggests **⌘⌥,**, next to Herdr's own **⌘,** for Settings. Merge it into `~/.config/herdr-app/keys.json`:

```json
{ "global": { "cmd-alt-,": "mod.open:better-config" } }
```

Herdr stops adding new default shortcuts to a `keys.json` you've edited, so if you've never changed yours, this is the edit that makes it yours. Without a key, this opens it too:

```sh
herdr-app do mod.open '{"name":"better-config"}'
```

## Use

No more hand-editing each mod's `mod.json` or reading its README to learn what a key does.

- **Open and close:** the key opens the dialog; the same key, or Esc, closes it.
- **One place:** the list on the left has each installed mod with settings, and a red dot marks one that needs attention. Each mod gets a page, with every setting's name, what it does and its key, grouped by the first part of the key.
- **The right control:** on/off switches, buttons for up to four choices or else a dropdown (↑, ↓, Enter, Esc), − and + for numbers, and text boxes for times (`450ms`, `10s`), sizes (`60KB`), text and comma-separated lists. A text box saves on Enter or when it loses focus.
- **Checked before saving:** a value that doesn't fit is explained in red under its field and never written. A bad value someone typed into `mod.json` by hand shows there too, instead of only in a log.
- **Applies at once:** a change is saved to the mod's own `mod.json`, and Herdr reloads the mod straight away.
- **See what you changed:** a dot marks every setting you've changed from its default. **Reset** puts one back, and **Reset all** puts a whole mod back.
- **Survives updates:** updating a mod replaces its `mod.json`, which used to throw your settings away. Better Config keeps a copy of what you changed, notices when an update put the defaults back, and lists each one in a box at the top, yours beside the current value, ticked to start. Untick the ones to keep as they are now; one button restores the ticked ones and keeps the rest.
- **See what's installed:** **Installed mods**, at the top of the list, shows every mod folder under Yours or Herdr's tabs, with a search box. Each row has the mod's title, folder and version, whether the layout on screen uses it or a key opens it, and a **Settings** button when it has settings. A folder with no `mod.json` still shows, marked as missing it.
- **Works with any mod:** a mod that ships a schema of its settings (see For developers) gets names, descriptions and checks. Any other mod with a `settings` block still shows, with its types guessed.
- **Herdr settings:** at the bottom of the list, opens Herdr's own Settings.

### Where values live

Values stay where each mod already reads them: the `settings` block of its installed `mod.json`, which holds only what you changed. A change back to the default removes the key. Nothing about a mod changes, and a mod works the same with or without Better Config.

Better Config also keeps a copy of only what you changed in `~/.config/herdr-mods/better-config/<mod>.json`, outside every mod's folder. When a kept value is missing from `mod.json`, or is back at its default, it asks whether to restore it. A value you changed by hand to something else is taken as yours, and the copy follows it. Every write goes through only if the file hasn't changed since it was read, so it never overwrites an edit made meanwhile.

### Limits

- **Mods with settings only:** a mod with no `settings` in its `mod.json` and none described in a `mod.schema.json` doesn't appear.
- **Only the keywords below:** the schema's settings are read for the keywords listed under For developers. `oneOf`, `$ref` and the like are ignored.
- **Not Herdr's own settings:** **Herdr settings**, at the bottom of the list, opens those.
- **Settings without a described default:** only a version change shows an update took them, so a reinstall of the same version goes unnoticed.
- **Nested objects:** values that are objects show as their separate keys. A list holds words only.

## Settings

Better Config has no settings of its own.

## Update

Copy `mods/better-config/` into `~/.config/herdr-app/mods/` again, or ask your agent to. The copy of your changes for other mods lives outside every mod's folder, in `~/.config/herdr-mods/better-config/`, so updating keeps it.

## For developers

### Describe a mod's settings

To have Better Config show your mod's settings, describe its `mod.json` in a JSON Schema beside it, `mods/<name>/mod.schema.json`, and point `mod.json` at it, so editors check the file too:

```json
{ "$schema": "./mod.schema.json", "version": "1.0.0", "place": "none", "title": "My Mod" }
```

The schema describes Herdr's own fields and, under `properties.settings`, each setting, nested the way `settings` is. Each leaf is a setting at its dotted key, such as `refresh.every`:

```json
"settings": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "refresh": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "every": { "title": "Refresh", "description": "How often the panel rereads.", "type": ["string", "integer"], "format": "duration", "default": "60s" }
      }
    },
    "page_size": { "title": "Page size", "description": "How many load at a time.", "type": "integer", "minimum": 1, "maximum": 100, "x-step": 5, "default": 25 },
    "view": { "title": "View", "description": "How the list starts.", "type": "string", "enum": ["tree", "flat"], "x-labels": { "tree": "Tree", "flat": "Flat" }, "default": "tree" }
  }
}
```

| Keyword | Meaning |
| --- | --- |
| `title`, `description` | What the dialog shows. The title defaults to the key's last part. |
| `default` | What the mod uses when nothing is set. Keep it equal to the default in the mod's code. **Reset** removes the key so the mod uses it. |
| `type` | `boolean`; `integer` or `number`; `string`; `array` of strings for a list. |
| `enum` | A fixed set of choices. Up to four show as buttons, more as a dropdown. `x-labels` names them: `{ "value": "Label" }`. |
| `format` | `duration` (`450ms`, `10s`) or `size` (`60KB`), with `type: ["string", "integer"]` since a bare number is also accepted. Add a `pattern` so editors check it. |
| `minimum`, `maximum` | A number's limits. `x-step` is how far − and + move it, `x-unit` a unit shown beside it, such as `px`. |

Only these keywords are read; `oneOf`, `$ref` and the like are ignored. The shipped `mod.json` has no `settings` block: it holds only what a person changes, and the mod uses its own defaults for the rest. Every mod in this repository ships a schema, and a test checks that each `mod.json` passes it and its defaults equal the mod's code.

### Work on the mod

- `mods/better-config/main.js`: the dialog.
- `mods/better-config/model.js`: fields, checks, typed input, what changed and what was lost. It holds everything that doesn't touch Herdr, and the tests run it as it is.
- `mods/better-config/shell.js`: the two shell commands, listing installed mods and making the kept folder, with a PowerShell version of each for Windows.
- `mods/better-config/mod.json`, `mod.schema.json`, `icons/`.
- `keys.json`: the suggested key.
- `sync.sh`: copies the mod into Herdr, which reloads it.
- `tests/config.test.cjs` and `tests/shell.test.cjs`: the tests.

```sh
node --test tests/*.test.cjs
./sync.sh
herdr-app check "$HOME/.config/herdr-app/mods/better-config"
```

Tests can't draw the dialog, so also look at the running app.

See [LICENSE](../LICENSE) and [NOTICE](../NOTICE) for attribution.
