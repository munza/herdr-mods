#!/bin/sh
# Copies the mod into Herdr, which reloads it. A symlink loads the code but not the icons.
# The installed mod.json holds the person's settings, so they are kept.
set -e
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
cd "$(dirname "$0")"
settings=$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json.settings) process.stdout.write(JSON.stringify(json.settings));
} catch {}
' "$home/mods/better-sidebar/mod.json")
rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json mods/better-sidebar/ "$home/mods/better-sidebar/"
if [ -n "$settings" ]; then
  node -e '
const fs = require("fs");
const file = process.argv[1];
const settings = JSON.parse(process.argv[2]);
const json = JSON.parse(fs.readFileSync(file, "utf8"));
json.settings = settings;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
' "$home/mods/better-sidebar/mod.json" "$settings"
fi
