import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@game-platform/contracts"],
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health/:path*", destination: `${api}/health/:path*` }
    ];
  }
};

export default nextConfig;
