#!/usr/bin/env bash
# Builds the Chrome Web Store package of extension/ from a git ref (default HEAD):
# output/save-to-gallery-<version>.zip. Only tracked files go in, so the
# git-ignored local-config.json (the token) never ships. Docs and stray images stay out.
set -euo pipefail
REF="${1:-HEAD}"
ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" archive "$REF" extension | tar -x -C "$TMP"
cd "$TMP/extension"
rm -f CHANGELOG.md README.md STORE.md .gitignore local-config.json ./*.png
VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
mkdir -p "$ROOT/output"
OUT="$ROOT/output/save-to-gallery-$VERSION.zip"
rm -f "$OUT"
zip -qr -X "$OUT" .
echo "$OUT"
