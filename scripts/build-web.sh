#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_SRC_DIR="$ROOT_DIR/web"
WEB_OUTPUT_DIR="${WEB_OUTPUT_DIR:-$WEB_SRC_DIR}"
SINGLE_TARGET_DIR="$ROOT_DIR/target/wasm-single"
THREAD_TARGET_DIR="$ROOT_DIR/target/wasm-threaded"
SINGLE_WASM="$SINGLE_TARGET_DIR/wasm32-unknown-unknown/release/artificial_life_wasm.wasm"
THREAD_WASM="$THREAD_TARGET_DIR/wasm32-unknown-unknown/release/artificial_life_wasm.wasm"
SINGLE_OUT_DIR="$WEB_OUTPUT_DIR/pkg-single"
THREAD_OUT_DIR="$WEB_OUTPUT_DIR/pkg-threaded"
THREAD_TOOLCHAIN="${THREAD_TOOLCHAIN:-nightly-2025-11-15}"
THREAD_RUSTFLAGS="${THREAD_RUSTFLAGS:--C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824 -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base}"

if [[ "$WEB_OUTPUT_DIR" != "$WEB_SRC_DIR" ]]; then
  rm -rf "$WEB_OUTPUT_DIR"
  mkdir -p "$WEB_OUTPUT_DIR"
  for asset in app.js coi-serviceworker.js favicon.svg index.html style.css; do
    cp "$WEB_SRC_DIR/$asset" "$WEB_OUTPUT_DIR/$asset"
  done
fi

rm -rf "$SINGLE_OUT_DIR" "$THREAD_OUT_DIR"

CARGO_TARGET_DIR="$SINGLE_TARGET_DIR" \
  cargo build \
  --manifest-path "$ROOT_DIR/Cargo.toml" \
  --release \
  --target wasm32-unknown-unknown
mkdir -p "$SINGLE_OUT_DIR"
wasm-bindgen --target web --out-dir "$SINGLE_OUT_DIR" "$SINGLE_WASM"

RUSTFLAGS="$THREAD_RUSTFLAGS" \
  CARGO_TARGET_DIR="$THREAD_TARGET_DIR" \
  cargo +"$THREAD_TOOLCHAIN" build \
  -Z build-std=panic_abort,std \
  --manifest-path "$ROOT_DIR/Cargo.toml" \
  --release \
  --target wasm32-unknown-unknown \
  --features parallel
mkdir -p "$THREAD_OUT_DIR"
wasm-bindgen --target web --out-dir "$THREAD_OUT_DIR" "$THREAD_WASM"
