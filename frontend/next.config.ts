import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/dashboard/products', destination: '/dashboard/documents', permanent: true },
      { source: '/dashboard/products/:path*', destination: '/dashboard/documents/:path*', permanent: true },
    ]
  },
  turbopack: {
    resolveAlias: {
      '@clerk/nextjs': './lib/clerk-mock',
    },
  },
};

export default nextConfig;
