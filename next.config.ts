import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  async redirects() {
    return [
      {
        source: "/",
        destination: "/forge",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
