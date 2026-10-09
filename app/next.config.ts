import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* standalone server for the Docker image (see /Dockerfile) */
  output: 'standalone',
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
