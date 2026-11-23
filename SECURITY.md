# Security Policy

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. Please don't open a public issue, and don't disclose it until it's fixed.

Include the mod and its version (from its `mod.json`), Herdr's version, your platform, the steps to reproduce it, and what an attacker could do. If an AI tool found it, say so, and confirm it yourself first.

You'll get a reply as soon as possible, and updates until it's fixed.

## Supported versions

The latest version of each mod on `main`. Update the mod before reporting.

## Scope

These mods run on your computer with Herdr's permissions, so these are of particular interest:

- **Shell commands.** Mods run `sh`, PowerShell, Git, `gh` and their own helpers with paths and names from the file tree, Git, web addresses and pull requests. Anything that lets such input run as a command is high severity.
- **Messages to agents.** Better Files, Better Search, Branch PR and Branch Issue send text to agents. Text that reaches an agent as something other than the message the person chose to send counts.
- **Secrets.** Branch Issue keeps a Linear API key, and the Branch helpers use `gh`'s login. Anything that exposes them counts.
- **Files a mod writes.** Better Config writes mods' `mod.json` and `keys.json`, and other mods keep caches under Herdr's folder. A write outside what a mod says it writes counts.
- **Helpers.** The Go helpers for Branch PR and Branch Issue and the Swift helper for Better Alerts, which are built on your machine at install.

Out of scope: anything that already needs code running on your machine, or write access to your Herdr folder or layouts.
