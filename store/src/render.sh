#!/bin/sh
# Rasterises an HTML/SVG file to PNG at an exact size with headless Chrome.
#   store/src/render.sh <input> <output.png> <width> <height> [transparent]
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="${TMPDIR:-/tmp}/clean-feed-render-profile"
BG=""
[ "$5" = "transparent" ] && BG="--default-background-color=00000000"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" --force-device-scale-factor=1 $BG \
  --window-size="$3,$4" --screenshot="$2" "file://$1" >/dev/null 2>&1
