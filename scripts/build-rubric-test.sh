#!/usr/bin/env bash
# Compile the rubric modules to plain CommonJS so `node --test` can require them.
#
# Mirrors packages/art-review/scripts/build-test.sh: the modules are pure
# TypeScript with no Next.js, React or database imports, so they compile and run
# standalone. Keep them that way — the point of phase 1 is logic that can be
# tested without standing up the app.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf test/.build
npx tsc src/lib/rubric/*.ts \
  --rootDir src/lib/rubric \
  --outDir test/.build \
  --module commonjs \
  --moduleResolution node \
  --target es2022 \
  --skipLibCheck \
  --esModuleInterop \
  --strict
