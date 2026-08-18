import type { NextConfig } from "next";

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

  // Allow access from any device on the local network (iPad, projector host)
  // in dev mode. Previously these were two separate `allowedDevOrigins` keys,
  // so only the last one applied and 192.168.86.25 was silently dropped.
  //
  // Subnet wildcards matter here because DHCP reassigns the studio machine's
  // address between sessions; pinning a single IP means the iPad silently
  // fails to hydrate after a lease change.
  allowedDevOrigins: [
    "192.168.86.*",
    "192.168.1.*",
    "10.55.30.*",
    "*.local",
  ],
};

export default nextConfig;
