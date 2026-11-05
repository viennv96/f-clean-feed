#!/bin/sh
# Builds Chrome Web Store graphics and the upload zip.
#   1. Serve clean-feed/ on http://localhost:8765 (the "fixture" launch config).
#   2. sh store/build.sh
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="${TMPDIR:-/tmp}/clean-feed-store-profile"
BASE="http://localhost:8765/store/src/shots.html"
VERSION=$(node -p "require('./manifest.json').version")

shot() { # <query> <out> <w> <h> <light|dark>
  SCHEME="--blink-settings=preferredColorScheme=1"
  [ "$5" = dark ] && SCHEME="--force-dark-mode"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE" --force-device-scale-factor=1 $SCHEME --virtual-time-budget=4000 \
    --window-size="$3,$4" --screenshot="$2" "$BASE?$1" >/dev/null 2>&1
}

for lang in en vi; do
  out="store/assets/$lang"
  mkdir -p "$out"
  shot "s=1&lang=$lang" "$out/screenshot-1.png" 1280 800 light
  shot "s=2&lang=$lang" "$out/screenshot-2.png" 1280 800 light
  shot "s=3&lang=$lang" "$out/screenshot-3.png" 1280 800 dark
  shot "s=4&lang=$lang" "$out/screenshot-4.png" 1280 800 dark
  shot "s=tile&lang=$lang" "$out/promo-small-440x280.png" 440 280 dark
  shot "s=marquee&lang=$lang" "$out/promo-marquee-1400x560.png" 1400 560 dark
done

# Store zip: the extension only, without tests and store sources.
mkdir -p dist
rm -f "dist/f-clean-feed-$VERSION.zip"
zip -qr "dist/f-clean-feed-$VERSION.zip" manifest.json _locales content icons popup -x "*.DS_Store"
echo "Built store/assets/{en,vi} and dist/f-clean-feed-$VERSION.zip"

# GitHub Pages copies of the graphics (docs/ is the published site).
cp store/assets/icon-512.png docs/assets/icon-512.png
for lang in en vi; do
  for n in 1 2 3; do cp "store/assets/$lang/screenshot-$n.png" "docs/assets/$lang-screenshot-$n.png"; done
done
echo "Copied graphics to docs/assets"

# Website: link-preview thumbnails (Open Graph / Twitter, 1200×630).
shot "s=og&lang=vi" docs/assets/og-image.png 1200 630 dark
shot "s=og&lang=en" docs/assets/og-image-en.png 1200 630 dark
for f in og-image og-image-en; do
  sips -s format jpeg -s formatOptions 88 "docs/assets/$f.png" --out "docs/assets/$f.jpg" >/dev/null
  rm "docs/assets/$f.png"
done

# Website: prerender strings and JSON-LD (version comes from manifest.json).
node store/src/site.mjs
