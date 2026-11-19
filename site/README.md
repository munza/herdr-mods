# Site

Builds [munza.github.io/herdr-mods](https://munza.github.io/herdr-mods/) from `docs/` and the mods' READMEs. Plain Node, no packages.

```sh
node site/build.cjs            # builds into _site/ (gitignored); open _site/index.html
node --test site/tests/*.test.cjs
```

- `mods.json`: the one list of docs pages, in sidebar order, under their group headings. The sidebar and the Previous/Next links on every docs page are built from it, and so are the home page's mod cards and filter buttons, one card per mod in a group with a `filter` (`label` names its button when the group title is too long). A mod marked `"generated": true` gets its page from `<mod>/README.md`. `needs` lists what it needs beyond Herdr, as Markdown, shown as "Needs: Git, `gh`" under the page title and "Needs Git and `gh`" on its card ("Nothing extra" when there is none).
- `build.cjs`: copies `docs/` into `_site/`, writes the generated pages, the cards in place of the marker comment in `docs/index.html`, and the sidebar and pager in any page still written by hand (Estro's).
- `page.cjs`: one README to one page, in the shell the hand-written pages use, with `docs/style.css`.
- `markdown.cjs`: the Markdown the READMEs use, and nothing more. Anything else fails the build with its line.

`.github/workflows/site.yml` builds and tests on every pull request and deploys `_site/` to GitHub Pages on every push to `main`. Generated pages are never committed: the build refuses a committed `docs/docs/<mod>.html` for a mod marked `generated`.

## How a mod's README is laid out

The README is still the main doc, read on GitHub; the site page is drawn from it. To be generated, it follows this shape:

```text
# <Mod name>                    same as its title in mods.json
<one-paragraph summary>         the page's lead, its search description and its home-page card
![alt](preview.png)             optional; the picture under the title and on the card

## Quick start                  a numbered list, three steps or so
## Install                      the prompt as a > quote (drawn as a box with Copy), then what the agent does, layout blocks, keys
## Use                          what it does and how to use it
## Settings                     how to change them, then a Key | Default | What it does table
## Update                       how to update and keep your settings
## For developers               props, commands, shared state, the code's layout, how to test
```

- The six sections are required, in that order. Others may sit between them, and each may have `###` subsections (shown as smaller headings, not in "On this page").
- The settings table must list every setting in `mod.schema.json` with its default, dotted for nested ones (`git.retry_after`), and nothing else; the build checks.
- The version on the page comes from `mods/<mod>/mod.json`.
- A picture under `docs/` is used where it is; any other is copied into the site.
- Links to another mod's `README.md` become links to its page; links to other files in the repo go to GitHub; a link to a file that doesn't exist fails the build.
- Lists are one level deep. No raw HTML, `####` headings or horizontal rules.

## Adding a mod

1. Write `<mod>/README.md` in the shape above.
2. Add it to `mods.json` with `"generated": true` and its `needs`, and to the list in the repository's README (a test checks the two match).
3. Run `node site/build.cjs` and look at `_site/index.html` and `_site/docs/<mod>.html`.

That's all the site needs: no HTML to write, and no other page to touch.
