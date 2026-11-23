# Contributing to Herdr Mods

Thanks for helping. Bug reports, fixes, platform support and new mods are all welcome. Check the open [issues](https://github.com/munza/herdr-mods/issues) and [pull requests](https://github.com/munza/herdr-mods/pulls) first, so two people don't build the same thing.

Read the [Code of Conduct](CODE_OF_CONDUCT.md) too. It's short, and it covers AI tools.

## What belongs here

Herdr is a place to direct agents, not an editor. A feature earns its place when it helps someone **see what needs attention, hand it to an agent, check the result, or merge it**. Tools for doing the work by hand (editing files, running tests, browsing like an IDE) usually belong to the agent or to an editor instead. That's a yardstick, not a hard rule, so for anything bigger than a fix, open a feature request first and settle whether it belongs before you build it.

Each mod also has to:

- **Look like Herdr.** Draw with the mod's `views/ui.js`, whose sizes, radii, type and colours are measured from Herdr's own mods. A new size or colour needs a reason in the PR.
- **Stay on Herdr's mod API.** No patching Herdr's shipped mods, and no reaching into another mod's folder; mods talk through `shared()` keys.
- **Keep the tooling plain.** Tests are `node --test` with no packages. The only native code is a mod's own helper (Go for Branch PR and Branch Issue, Swift for Better Alerts), built on the user's machine at install. No global installs.

## Setup

You need Node.js 24 for the tests and the site, Go 1.23+ if you touch Branch PR or Branch Issue, and [Herdr Desktop](https://herdr.dev/) to try your change.

- Put Herdr's `herdr.d.ts` and `gpui-kit.d.ts` beside a mod's code for editor types. They're gitignored.
- Run a mod's `./sync.sh` to copy it into Herdr, which reloads it. Branch PR and Branch Issue have no `sync.sh`: install them by their `RECIPE.md`.
- `herdr-app check <mod folder>` loads a mod once and reports what's wrong, for example `herdr-app check better-files/mods/better-files`.

## How a mod is laid out

```text
<mod>/
├── mods/<mod>/        the code Herdr loads: main.js, mod.json, mod.schema.json, views/ …
├── tests/             node --test files, with Herdr's API stubbed
├── README.md          for people; the site's docs page is generated from it
├── RECIPE.md          for the agent that installs it
├── preview.png        the picture on the README, the site and the card
└── sync.sh            copies mods/<mod>/ into Herdr while you work
```

- **Settings** are described once in `mod.schema.json`, with their defaults in the code's `DEFAULT_SETTINGS`. A test in `better-config/tests/config.test.cjs` checks every mod's schema, `mod.json` and defaults against each other, and the site build checks the README's settings table.
- **Platform code** goes behind the mod's platform seam, never in a view. In Better Files, each platform's shell commands are one object in `files/shell/<platform>.js` (`posix.js` holds what macOS and Linux share), and `files/shell.js` only picks one. To support a platform, add its file and its entry in `PLATFORMS`. A label or a key that differs per platform may check `window().platform` where it's drawn.
- **A new mod** also goes in `site/mods.json`, the repository README's list, and, if Estro should install it, `estro/mods/<mod>/`. [site/README.md](site/README.md) says how a README must be laid out for its docs page.

## Test

```sh
node --test */tests/*.test.cjs site/tests/*.test.cjs
for m in */helper/go.mod; do (cd "${m%/go.mod}" && go test ./... && go vet ./...); done
node site/build.cjs
herdr-app check <mod>/mods/<mod>
```

CI runs the Node tests on Ubuntu and macOS for every pull request, plus `gofmt`, `go vet` and `go test` for the Go helpers and a compile of the Swift helper. These checks, the site build and the PR title check must pass before a PR can merge; [.github/rulesets/main.json](.github/rulesets/main.json) holds the rules for `main`. A first-time contributor's run waits for a maintainer to approve it, so run them locally too. A test that runs a real shell script on another platform should skip where that platform's tools are missing, as Better Files' Linux and Windows tests do.

## Pull requests

- **One mod per PR**, and one change. A fix and a feature are two PRs. Changes that a feature needs in another mod (a shared key it reads, say) can come along; say so in the summary.
- **Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).** Every section, or a line saying why it doesn't apply.
- **Show it working.** A visual change needs a before and after screenshot or recording. Otherwise, the test that failed before and passes after.
- **Say where you tried it.** macOS, Windows or Linux, and whether in the running app or only in tests. "Only tests on Linux" is a fine answer; it tells the reviewer what's left.
- **Update the docs your change makes wrong:** the mod's README, RECIPE and schema.
- **Leave `mod.json`'s `version` alone.** The maintainer bumps it at merge time, since several PRs often touch one mod.
- **Read your own diff top to bottom** before you open the PR.

PRs are squash-merged, so the PR title becomes the commit on `main`. Write it as `type(mod): what it does`, such as `fix(better-files): fetch preview badges on Windows`. The types are `feat`, `fix`, `refactor`, `test`, `docs`, `ci` and `chore`; the mod in brackets is optional for changes that span the repository. A check on the PR tells you if the title doesn't fit.

**Stacked PRs:** if your PR builds on another open PR, say so at the top. After the lower one is squash-merged, rebase yours onto `main` with `git rebase --onto origin/main <lower-branch>`. Its commits are no longer on `main` under the same names, so a plain rebase conflicts.

## Reporting bugs

Use the [bug form](https://github.com/munza/herdr-mods/issues/new?template=bug.yml): the mod, your platform, Herdr's version, what you did, and what you expected and got. A screenshot or recording beats a paragraph.

## Security

Don't report a vulnerability in an issue. See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). By opening a pull request, you agree your contribution is licensed under the same terms, as the license's section 5 sets out. If your change adapts code from elsewhere, say where from, and add it to [NOTICE](NOTICE).
