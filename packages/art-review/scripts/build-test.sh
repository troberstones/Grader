#!/usr/bin/env bash
# Compile src/core and the browser-free part of src/sources to CommonJS so
# `node --test` can require them.
#
# This existed only as a comment in core.test.cjs for a while, and test/.build
# is gitignored — so the tests ran green against whatever snapshot of core
# happened to be lying there, which drifted hours behind the source. Building
# every run is cheap and is the only thing that makes a pass mean anything.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf test/.build

# rootDir pins the layout to test/.build/{core,sources} whatever the file list
# is, so adding a file never silently moves everything else.
#
# The sources listed are the ones whose only browser dependency is a handful of
# globals a test can stand in for. The rest (pdf, video, psd) pull real workers
# and codecs and stay out. ingest.ts is here for its pure parts — sharp, ffmpeg
# and the EXR decoder are all behind dynamic imports, so requiring it costs
# nothing until one of them is actually called.
npx tsc src/core/*.ts src/sources/bitmap-cache.ts src/sources/still.ts src/server/ingest.ts \
  --rootDir src \
  --outDir test/.build \
  --module commonjs \
  --moduleResolution node \
  --target es2022 \
  --skipLibCheck \
  --esModuleInterop \
  --strict

# Marks the output CJS despite the package being "type": "module".
echo '{"type":"commonjs"}' > test/.build/package.json
