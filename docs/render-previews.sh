#!/bin/sh
# Renders the README images from docs/preview.html with headless Google Chrome.
# Usage: sh docs/render-previews.sh   (from anywhere; needs python3 and Chrome)
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=8799
TMP="$(mktemp -d)"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1
shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$TMP/$1" \
    --force-device-scale-factor=2 --window-size=1050,640 --virtual-time-budget=2000 \
    --screenshot="docs/$1.png" "http://127.0.0.1:$PORT/docs/preview.html?readme&$2" >/dev/null 2>&1
  echo "docs/$1.png"
}
shot preview en
shot preview-de dark
