import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: {
    loader: "custom",
    loaderFile: "./figma-image-loader.ts",
  },
  allowedDevOrigins: [],
  enablePrerenderSourceMaps: false,
  experimental: {
    agentUpgrade: "security",
  },
}

export default nextConfig
