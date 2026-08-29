import os from "os";
import type { NextConfig } from "next";

/**
 * The studio Mac's LAN address before the trailing octet — e.g. "10.55.31."
 * for 10.55.31.52 — for every non-internal IPv4 interface it currently has.
 *
 * DHCP has reassigned this machine's address across at least three different
 * /24s so far (192.168.86.x, then 10.55.30.x, now 10.55.31.x) despite all of
 * them being the same physical studio network — a wildcard pinned to one of
 * those octets silently stops matching the next time the lease renews, and
 * the symptom is not an error: the iPad's Safari paints the page but every
 * Server Action and RSC request 403s, so nothing on screen responds to touch.
 * Computing this from the live interface at boot means a lease change only
 * needs `npm run dev` restarted, not this file edited.
 */
function currentLanSubnets(): string[] {
  const subnets = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        subnets.add(`${addr.address.split(".").slice(0, 3).join(".")}.*`);
      }
    }
  }
  return [...subnets];
}

const nextConfig: NextConfig = {
  // sharp and ag-psd are server-only (native bindings / large parsers) and must
  // not be pulled into a client bundle.
  serverExternalPackages: ["better-sqlite3", "sharp", "ag-psd"],

  // Default Server Action body limit is 1MB — far below one raw artwork file,
  // let alone a multi-frame EXR sequence uploaded in one request.
  experimental: {
    serverActions: {
      bodySizeLimit: "3gb",
    },
  },

  // The art review module ships TypeScript source rather than a build step, so
  // Next compiles it as part of the app.
  transpilePackages: ["@grader/art-review"],

  // `next start` gzip-compresses every response by default, including the
  // Range-served video/audio streams from /api/review/media — compression
  // rewrites the body length but the route's Content-Length/Content-Range
  // headers still describe the uncompressed byte range, so browsers abort
  // playback with ERR_CONTENT_LENGTH_MISMATCH. Media is already compressed
  // (h264/aac/etc.), so gzip bought nothing there anyway; there's no reverse
  // proxy in front to move compression to instead.
  compress: false,

  // Allow access from any device on the local network (iPad, projector host)
  // in dev mode. Previously these were two separate `allowedDevOrigins` keys,
  // so only the last one applied and 192.168.86.25 was silently dropped.
  // currentLanSubnets() covers whatever this machine's DHCP lease is right
  // now; the rest are past/other networks kept as a fallback.
  allowedDevOrigins: [
    ...currentLanSubnets(),
    "192.168.86.*",
    "192.168.1.*",
    "10.55.30.*",
    "*.local",
  ],
};

export default nextConfig;
