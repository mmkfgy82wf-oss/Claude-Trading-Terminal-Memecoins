import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The agent orchestrator is a long-lived in-process singleton. Keep it out of
  // any bundling that would duplicate module instances across route handlers.
  serverExternalPackages: [],
};

export default nextConfig;
