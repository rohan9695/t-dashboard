import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // All /api routes run on the Edge runtime for low latency
  // (configured per-route with `export const runtime = 'edge'`)

  // Serve the service worker with no-cache headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ]
  },
}

export default nextConfig
