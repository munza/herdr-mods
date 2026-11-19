# Better Search

One popup that finds anything, for a person directing agents who wants to reach the tab, agent or command that needs them without hunting for it. Judge any addition by whether it helps them see what needs attention, hand it to an agent, check the result or merge. It's not a file finder for writing code by hand.

## What you see

A popup at the top of the window, 40px down, 680 wide and up to 80% of the window tall, in the `popover` color with 18px padding, drawn like Herdr's own picker and command palette. At the top, a 36px search box with an `accent` border, Herdr's search icon and "Esc" on the right. Under it, a row of chips, one per prefix (`@ agents`, `> commands`, `/ files`, `~ spaces`, `? output`, `# PRs`, `$ issues`): the one typed has an `accent` border on `selected`, and a click types its prefix (or clears it). Below, up to ten 32px rows with 26px section titles, and at the bottom what the selected row can do (`↵ go   ⇧↵ peek   ⌘↵ message`, `↵ run`, `↵ open   ⌘↵ hand to agent`, plus `⇥ all` in a section that shows only some), with "Esc close" on the right.

With nothing typed, it lists every tab of every space in one list, no headings: blocked first, then done, then working, then quiet, each in space and tab order. Each tab row has a status glyph (a spinning `working` ring, a `blocked` or `done` dot, `○` for idle), its name (semibold for the one you're in), right after it in `dim` its agents' program names with `+N` for sub-agents (or, for a waiting agent, the question on its screen in `muted`), then "needs you · 3m" or "finished · 3m" when that's its state (from the tab's `changed_at`), and on the right its space, with " · <machine>" for a remote one. It opens on the tab you were in before, marked "last", else the one you're in. Last come New tab, New space, and New space on each connected machine.

A leading character narrows the list to one kind:

| Prefix | Lists | Enter |
|---|---|---|
| `@` | Agents: blocked, done, working, idle, pinned first within each, newest first; program after the name, then the state spelled out in its color ("needs you · 3m", "finished", "working", "idle") and the space on the right | `agent.focus` |
| `>` | Herdr's commands from `commands()`, except ones that point at something, plus one row for each layout, theme and Settings section, and Mod settings when Better Config is installed. Keys from `keys()`; recent first | Runs it, remembering it as recent |
| `/` | Files from `git ls-files --cached --others --exclude-standard`, by name, folder on the right; at most 60 rows | Opens it in Better Files |
| `~` | Spaces, the ones that need you first, with branch and machine; New space on each machine | `space.select` / `space.new` |
| `#` | Pull requests, asked of Branch PR's `bin/herdr-pr` (`list`, the space's GitHub repo from its upstream or origin remote, open ones or `state: all` with the search) 400ms after typing stops; author and branch after the title, then its state (merged in `done`, closed or draft `dim`, open in `working`) and its link without the scheme on the right. Cmd+Enter opens the link. While it looks, or when it fails or finds none, the list says so | Writes shared `branch-pr.open` `{ space, number, repo, at }`, then selects Branch PR's block in each stack above it and shows any hidden node on the way; with no such block in the layout, opens its URL |
| `$` | Issues, asked of Branch Issue 3's `bin/herdr-issue` (`source: "linear"` and, with a GitHub remote, `source: "github"`, at once; one that fails adds nothing) or Branch Issue 2's `bin/herdr-linear` (Linear only); assignee after the title, state and link as for PRs | The same with `branch-issue.open` `{ space, identifier, ref, at }` (`identifier` for Branch Issue 2, `ref` such as `linear:ENG-3` or `github:16` for 3) and Branch Issue |
| `?` | Lines agents printed holding the text (case aside, not fuzzy, two letters at least), newest first, each line once per agent, cut to 140 characters around the match; agent and space on the right; at most 60 | `agent.focus` |

Any other text searches every kind: all matching tabs (the space's name in front of the detail), then up to five each of agents, spaces, commands and files, each under its heading, which adds "5 of 132" when some are left out, or "reading…" for files not read yet. Tab on a row of a cut section types that section's prefix before the text. Matched letters show in `accent`.

Shift+Enter on a tab or agent runs `terminal.peek` on its agent. Cmd+Enter on one switches the box to a message to that agent: the search box gives way to a textarea that grows from 3 to 10 lines under "Message to <name>:", with a "File: <path>" chip under it when a file goes too. Enter adds a line, Cmd+Enter sends it with `hc send`. Cmd+Enter on a file shows "Hand <file> to", lists agents, and Enter on one opens the message box. The message goes as typed, followed by a blank line and `File: <absolute path>`. A failed send shows in `blocked` under the box and keeps the text. Esc goes back one step, then closes.

## How it works

`model.js` builds the rows from data `main.js` passes in: `spaces()`, `agents()`, live `terminals()` for sub-agent counts, connected machines from `hc machine ls --json`, the command entries, recent picks from shared `better-search.recent` (20 kept), and the space's files. Fuzzy matching is Herdr's palette's: letters in order, word starts and runs ranked higher. A row matching only on its other words ranks 4 lower than one matching its title.

When it opens, it puts the current tab on top of shared `better-search.visits` (30 kept; a picked tab goes on top too), and the newest other tab there that still exists is "last". It runs `hc read <agent>` for each blocked agent and keeps the lowest screen line ending in `?`, without box and bullet marks, as its question. The first `?` runs `hc read <agent> --lines 2000` for every agent, once.

Files are read once when it opens: `git rev-parse --show-toplevel` in the focused terminal's folder (if it's in the shown space), else the space's folder, then `git ls-files` there, on the space's machine with `exec(..., { on })`. At most `files.limit` are kept.

Opening a file does what Better Files does: if a Better Files tab in this space already shows it, `tab.select`; otherwise it adds an entry to shared `better-files.viewers` (`{ space, file: { path, root, on }, preview: false, tab: null, others, at }`) and runs `tab.new` with `mod: "better-files"` and props `{ mode: "viewer", viewer, space, file }`, so Better Files' sidebar and menus know the tab.

The list scrolls like Herdr's palette: each row placed by its edges at a fixed y, scrolled only as far as keeps the selected row and the title above it in view. Arrows stop at the ends and skip titles.

## Built from

`mods/better-search/`: `main.js` (the popup), `model.js` (prefixes, rows, ranking, command entries; no Herdr calls), `settings.js` (shared with the other mods), `mod.json` (`place: none`, a popup `overlay` at the top), `mod.schema.json`. `keys.json` suggests **⌘⌥P**. Icons are Herdr's own `mods/workspace-chrome/search.svg` and `spinner.svg`. The look follows Herdr's `frame/palette/main.js` and `mods/picker/main.js`.

## Watch out

Merge `keys.json` into the person's only when they agree, and never replace a key they already use: **⌘P** is Herdr's picker and **⌘⇧P** its palette. Moving Better Search onto them is the person's choice, through the `key` setting (`format: "key"`, `x-action: "mod.open:better-search"`), which Better Config binds in `keys.json`, taking over the key and giving it back when it changes again. The popup itself never reads `key`. Herdr stops updating the default shortcuts of a `keys.json` that's been edited. Never overwrite an unrelated mod on a name clash.

The search box can't be multi-line, so the message is a separate `TextareaState`, and only a submit with `secondary` (Cmd) sends, so plain Enter stays a new line. The popup's arrow keys stand down while it's open, or the textarea couldn't move its cursor. A key can't pass props to `mod.open`, so there's no key that opens the popup with a prefix already typed.

## Done when

- `herdr-app check` passes and `mod.open better-search` shows every tab in every space in one list, the ones that need you first, on the tab you were in before.
- The chips under the search box show all seven prefixes and light the one typed; a click types it.
- `@`, `>`, `/`, `~` and `?` each list their kind; other text shows sections, and Tab on a cut section shows all of it.
- `#` lists pull requests through Branch PR's helper and `$` issues through Branch Issue's; Enter opens one in its panel, which shows its loading line at once; Cmd+Enter opens its link.
- Enter on a tab, agent, space, command and file does what the table says; a file opens in a Better Files tab, and picking it again goes to that tab.
- Cmd+Enter on an agent sends a typed message of several lines to it; on a file, the message arrives with `File: <path>`.
