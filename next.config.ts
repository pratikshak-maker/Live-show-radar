import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.dzcdn.net" },
      { protocol: "https", hostname: "i.scdn.co" },
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
