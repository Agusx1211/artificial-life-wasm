#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HTTP_PORT="${1:-8000}"
HTTPS_PORT="${2:-8443}"
CERT_DIR="$ROOT_DIR/.local-certs"

echo "Building web bundles..."
"$ROOT_DIR/scripts/build-web.sh"

mapfile -t CERT_FILES < <("$ROOT_DIR/scripts/devcert.sh" "$CERT_DIR")

exec python3 \
  "$ROOT_DIR/scripts/serve_web.py" \
  "$HTTP_PORT" \
  "$HTTPS_PORT" \
  "${CERT_FILES[0]}" \
  "${CERT_FILES[1]}"
