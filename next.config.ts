import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @grader/art-review is installed with `--install-links`, so it lands in
  // node_modules as a real directory rather than a symlink out to
  // ../artReviewModule. That keeps every import inside the project root.
  //
  // Raising `turbopack.root` to the parent directory would also resolve the
  // symlink, but it moves PostCSS/Tailwind plugin resolution up with it and
  // Tailwind then fails to resolve at all. Copy, don't move the root.
  // Re-sync after editing the module with: npm run sync:review
  // sharp and ag-psd are server-only (native bindings / large parsers) and must
  // not be pulled into a client bundle.
  serverExternalPackages: ["better-sqlite3", "sharp", "ag-psd"],

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
