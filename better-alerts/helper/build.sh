#!/bin/sh
# Builds HerdrAlerts.app, Better Alerts' macOS notifier, into the installed mod's bin/ (or the
# folder given), with Herdr's icon, signed for this Mac. Needs swiftc and codesign, from Xcode's
# Command Line Tools: xcode-select --install.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/better-alerts/bin}
app="$out/HerdrAlerts.app"

[ "$(uname -s)" = Darwin ] || { echo "HerdrAlerts is for macOS; Linux uses notify-send." >&2; exit 1; }
command -v swiftc >/dev/null || { echo "swiftc is missing: run xcode-select --install" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/HerdrAlerts.app/Contents/MacOS" "$tmp/HerdrAlerts.app/Contents/Resources"
swiftc -O -o "$tmp/HerdrAlerts.app/Contents/MacOS/HerdrAlerts" "$here/main.swift"
cp "$here/Info.plist" "$tmp/HerdrAlerts.app/Contents/Info.plist"
# Herdr's own icon, from wherever macOS knows Herdr is; without it the banner shows a blank one.
herdr=$(mdfind "kMDItemCFBundleIdentifier == 'dev.herdr.app'" 2>/dev/null | head -n 1)
icon="${herdr:-/Applications/Herdr.app}/Contents/Resources/Herdr.icns"
if [ -f "$icon" ]; then cp "$icon" "$tmp/HerdrAlerts.app/Contents/Resources/Herdr.icns"; else echo "Herdr's icon wasn't found; the banner shows a blank one." >&2; fi
codesign --force --sign - "$tmp/HerdrAlerts.app"

mkdir -p "$out"
rm -rf "$app"
mv "$tmp/HerdrAlerts.app" "$app"
echo "Built $app"
