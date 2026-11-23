# Herdr Mods

Mods for Herdr Desktop, each in its own folder (`<mod>/mods/<mod>/` is what Herdr loads), plus the Estro layout and the site in `site/`. [CONTRIBUTING.md](CONTRIBUTING.md) holds the setup, the layout of a mod, the test commands and the rules for pull requests; they apply to agents exactly as to people. Read it before your first change.

## Judging a feature

Herdr is an agent environment, not an IDE. Keep what helps a person see what needs attention, hand it to an agent, check the result, or merge; leave hand-editing and IDE work to the agent or an editor. When adding or reworking a mod's features, list them as keep / cut / add with a recommendation, and let the maintainer decide before building.

## Gotchas

- **Some tests glue a mod's files into one scope.** `better-files/tests/files.test.cjs`, `branch-pr/tests/pr.test.cjs` and `branch-issue/tests/issue.test.cjs` read the files in their `FILES` list, strip imports and exports, and run them as one script. A new file goes in that list, in import order, and top-level names must be unique across the mod. `better-files/tests/shell.test.cjs` joins `files/shell/*.js` the same way through `SHELL_FILES`.
- **Some files are copies that stay identical.** `syntax.js` in Better Files and Better Changes; `file-icons.js` in Better Icons, Better Changes, Better Files and Branch PR. Change one, change them all in the same PR.
- **Platform code goes behind the seam.** Shell commands in Better Files live in `files/shell/<platform>.js`. A view or action calls `pick*` from `files/shell.js`, never `exec("sh", …)` with its own platform check.
- **A README is the source of a site page.** `site/markdown.cjs` supports only the Markdown the READMEs already use, and the build fails on anything else, with its line. Run `node site/build.cjs` after editing a mod's README. Generated pages are never committed.
- **RECIPE.md is read by the agent that installs the mod.** When a change alters what's installed (files, keys, layout blocks, a helper's build), update the RECIPE in the same PR.
- **CI job names are required checks.** `.github/rulesets/main.json` is an export of `main`'s ruleset, which requires the jobs by name. Renaming or adding a job in a workflow means updating the ruleset in Settings → Rules and exporting it again in the same PR; a renamed job otherwise blocks every PR.
- **Settings live in three places that a test keeps in step:** `mod.schema.json`, the code's `DEFAULT_SETTINGS`, and the README's settings table.

## Writing

READMEs, RECIPEs, commit messages and PR bodies use plain words and short sentences. One line per paragraph or list item in Markdown, never hard-wrapped. A PR body follows [the template](.github/PULL_REQUEST_TEMPLATE.md): Summary, Evidence, Merge Danger, AI usage.
