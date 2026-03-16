import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'
import aisWebSocketProxy from './vite-plugin-ais-proxy'

export default defineConfig(({ mode }) => {
  // Load .env / .env.local so process.env.VITE_* is available in proxy callbacks
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), cesium(), tailwindcss(), aisWebSocketProxy()],
    server: {
      proxy: {
        '/adsbfi': {
          target: 'https://api.adsb.fi',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsbfi/, ''),
        },
        '/celestrak': {
          target: 'https://celestrak.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/celestrak/, ''),
        },
        '/firms': {
          target: 'https://firms.modaps.eosdis.nasa.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/firms/, ''),
        },
        // OpenSky data API — browser sends Bearer token in Authorization header
        '/opensky': {
          target: 'https://opensky-network.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/opensky/, ''),
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              delete proxyRes.headers['www-authenticate']
            })
          },
        },
        // OpenSky OAuth2 token endpoint (proxied to avoid CORS on localhost)
        '/opensky-token': {
          target: 'https://auth.opensky-network.org',
          changeOrigin: true,
          rewrite: () => '/auth/realms/opensky-network/protocol/openid-connect/token',
        },
        // n2yo.com satellite API
        '/n2yo': {
          target: 'https://api.n2yo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/n2yo/, ''),
        },
        // gpsjam.org GPS interference data
        '/gpsjam': {
          target: 'https://gpsjam.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gpsjam/, ''),
        },
        // Windy Webcams API — inject API key server-side
        '/windy': {
          target: 'https://api.windy.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/windy/, ''),
          configure: (proxy) => {
            const key = env.VITE_WINDY_WEBCAMS_KEY ?? ''
            proxy.on('proxyReq', (proxyReq) => {
              if (key) proxyReq.setHeader('x-windy-api-key', key)
              // Remove origin/referer so Windy sees server-to-server (no domain restriction)
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
        // Google Map Tiles API (traffic overlay + data sampling)
        '/gmap-tiles': {
          target: 'https://tile.googleapis.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/gmap-tiles/, ''),
          configure: (proxy: any) => {
            const gmapKey = env.VITE_GOOGLE_MAPS_API_KEY ?? ''
            proxy.on('proxyReq', (proxyReq: any) => {
              const url = new URL(proxyReq.path, 'https://tile.googleapis.com')
              url.searchParams.set('key', gmapKey)
              proxyReq.path = url.pathname + url.search
            })
          },
        },
        // AISStream WebSocket is handled by vite-plugin-ais-proxy (manual upgrade)
      },
    },
  }
})
