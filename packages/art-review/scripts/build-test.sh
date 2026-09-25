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
# globals a test can stand in for. The rest (pdf) pull real workers and codecs
# and stay out. ingest.ts is here for its pure parts — sharp, ffmpeg and the
# EXR decoder are all behind dynamic imports, so requiring it costs nothing
# until one of them is actually called.
#
# psd.ts and exr.ts are here for their header-only dimension readers
# (readPsdHeaderDimensions, peekExrDimensions) — the whole reason those exist
# is to reject an oversized canvas from raw header bytes *before* ag-psd/the
# vendored EXR decoder ever allocate anything, so a test needs to reach them
# without pulling in ag-psd, sharp or the EXR decoder. Both modules only touch
# those behind dynamic imports too, and exr.ts's one real dependency —
# vendor/exr-loader.ts — is self-contained (node:zlib only), so it compiles
# and loads here for free. shaders.ts and image-limits.ts ride along as their
# non-dynamic dependencies.
#
# decoded-video.ts's only real (non-type-only) imports are core/budget.ts and
# sources/ledger.ts, both already on this list — mp4box and the WebCodecs
# globals (VideoDecoder, fetch, OffscreenCanvas) are either a dynamic import or
# read off `globalThis`, so a test can stand in for them the same way
# sources.test.cjs already does for StillSource/BitmapCacheSource.
npx tsc src/core/*.ts src/sources/bitmap-cache.ts src/sources/still.ts src/server/ingest.ts \
  src/render/shaders.ts src/server/image-limits.ts src/server/psd.ts src/server/exr.ts \
  src/sources/decoded-video.ts \
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
