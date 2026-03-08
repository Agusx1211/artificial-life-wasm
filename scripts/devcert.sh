#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${1:-$ROOT_DIR/.local-certs}"
CERT_PATH="$CERT_DIR/dev-local.crt"
KEY_PATH="$CERT_DIR/dev-local.key"

mkdir -p "$CERT_DIR"

host_entries=("DNS:localhost" "IP:127.0.0.1")

while read -r entry; do
  host_entries+=("IP:${entry}")
done < <(hostname -I | tr ' ' '\n' | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/')

san_csv="$(printf '%s,' "${host_entries[@]}")"
san_csv="${san_csv%,}"

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -days 365 \
  -nodes \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -subj "/CN=localhost" \
  -addext "subjectAltName = ${san_csv}" \
  >/dev/null 2>&1

printf '%s\n%s\n' "$CERT_PATH" "$KEY_PATH"
