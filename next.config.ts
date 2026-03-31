import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Allow access from any device on the local network (iPad, etc.) in dev mode.
  allowedDevOrigins: ["192.168.86.25"],
  allowedDevOrigins: ["10.55.30.168"],
};

export default nextConfig;
