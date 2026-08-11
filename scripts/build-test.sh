#!/usr/bin/env bash
# Compile src/core to CommonJS so `node --test` can require it.
#
# This existed only as a comment in core.test.cjs for a while, and test/.build
# is gitignored — so the tests ran green against whatever snapshot of core
# happened to be lying there, which drifted hours behind the source. Building
# every run is cheap and is the only thing that makes a pass mean anything.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf test/.build

npx tsc src/core/*.ts \
  --outDir test/.build \
  --module commonjs \
  --moduleResolution node \
  --target es2022 \
  --skipLibCheck \
  --strict

# Marks the output CJS despite the package being "type": "module".
echo '{"type":"commonjs"}' > test/.build/package.json
