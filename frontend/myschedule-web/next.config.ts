import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Clickjacking protection for modern browsers; script/style policy is left to the
  // defaults so Next's inline bootstrap scripts keep working.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone/server.js) for the Docker image.
  output: "standalone",
  // Flask blueprints serve collection routes with a trailing slash (/shifts/, /drops/).
  // Next's automatic slash-stripping redirect would bounce every /api/proxy/shifts/ call
  // through two 308s; proxy.ts normalises page URLs itself instead.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
