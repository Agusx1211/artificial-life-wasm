#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_DIR="${PAGES_DIR:-$ROOT_DIR/dist}"

WEB_OUTPUT_DIR="$PAGES_DIR" "$ROOT_DIR/scripts/build-web.sh"
touch "$PAGES_DIR/.nojekyll"
