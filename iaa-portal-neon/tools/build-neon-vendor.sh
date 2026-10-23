#!/usr/bin/env bash
# Rebuilds public/vendor/neon-js-<version>.js, the browser copy of Neon's
# client library. Only needed when upgrading the library. Requires Node.js.
# Usage: bash tools/build-neon-vendor.sh 0.7.0-beta
set -euo pipefail
VERSION="${1:-0.7.0-beta}"
ROOT="$(pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install "@neondatabase/neon-js@${VERSION}" esbuild@0.24.2 --legacy-peer-deps --silent
cat > entry.js <<JS
import { createClient } from "@neondatabase/neon-js";
window.NeonJS = { createClient: createClient, version: "${VERSION}" };
JS
npx esbuild entry.js --bundle --format=iife --platform=browser --target=es2019 \
  --minify --legal-comments=none \
  --banner:js="/*! @neondatabase/neon-js ${VERSION}, bundled for the IAA Staff Portal with esbuild 0.24.2 (see tools/build-neon-vendor.sh). Exposes window.NeonJS.createClient. */" \
  --outfile="neon-js-${VERSION}.js"
cp "neon-js-${VERSION}.js" "$ROOT/public/vendor/"
echo "Built public/vendor/neon-js-${VERSION}.js – update the script tag in public/index.html to match."
