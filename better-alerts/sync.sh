#!/bin/sh
# Copies the mod into Herdr, which reloads it. Keeps bin/, where helper/build.sh puts
# HerdrAlerts.app on macOS.
cd "$(dirname "$0")" && rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json --exclude bin mods/better-alerts/ "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/better-alerts/"
