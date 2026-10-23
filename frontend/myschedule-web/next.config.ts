import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Flask blueprints serve collection routes with a trailing slash (/shifts/, /drops/).
  // Next's automatic slash-stripping redirect would bounce every /api/proxy/shifts/ call
  // through two 308s; proxy.ts normalises page URLs itself instead.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
};

export default nextConfig;
