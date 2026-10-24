#!/usr/bin/env bash
# Build a Chrome-installable ZIP in this project's root directory.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OUTPUT="$ROOT/RemiInstagramDownloader.zip"

if ! command -v zip >/dev/null 2>&1; then
  printf 'Error: zip is required. Install it and rerun pack.sh.\n' >&2
  exit 1
fi
if ! grep -Eq '"version"[[:space:]]*:[[:space:]]*"0\.1\.0"' "$ROOT/manifest.json"; then
  printf 'Error: manifest.json version must remain 0.1.0.\n' >&2
  exit 1
fi

# Explicit file list prevents tests, caches, scripts, and old ZIPs
# from being packed into the Chrome extension.
files=(
  manifest.json
  background.js
  content.js
  page-observer.js
  offscreen.html
  offscreen.js
  README.md
  icons/16.png
  icons/48.png
  icons/128.png
)
for file in "${files[@]}"; do
  if [[ ! -f "$ROOT/$file" ]]; then
    printf 'Error: missing required file: %s\n' "$file" >&2
    exit 1
  fi
done

STAGING="$(mktemp -d "$ROOT/.remi-pack.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
(
  cd -- "$ROOT"
  zip -q -X "$STAGING/RemiInstagramDownloader.zip" "${files[@]}"
)
# Check that the generated archive is intact before overwriting the old one.
if ! unzip -tqq "$STAGING/RemiInstagramDownloader.zip" >/dev/null 2>&1; then
  printf 'Error: ZIP integrity check failed.\n' >&2
  exit 1
fi
mv -f -- "$STAGING/RemiInstagramDownloader.zip" "$OUTPUT"
printf 'Created: %s\n' "$OUTPUT"
