import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'
import aisWebSocketProxy from './vite-plugin-ais-proxy'
import spaceTrackProxy from './vite-plugin-spacetrack-proxy'
import cctvProxy from './vite-plugin-cctv-proxy'

export default defineConfig(({ mode }) => {
  // Load .env / .env.local so process.env.VITE_* is available in proxy callbacks
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), cesium(), tailwindcss(), aisWebSocketProxy(), spaceTrackProxy(), cctvProxy()],
    server: {
      proxy: {
        '/adsbfi': {
          target: 'https://opendata.adsb.fi',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsbfi/, ''),
        },
        // adsb.lol sends no CORS headers — must proxy (airplanes.live is ACAO:* so it's called direct)
        '/adsblol': {
          target: 'https://api.adsb.lol',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsblol/, ''),
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
        // OpenSky OAuth2 token endpoint — credentials injected server-side
        '/opensky-token': {
          target: 'https://auth.opensky-network.org',
          changeOrigin: true,
          rewrite: () => '/auth/realms/opensky-network/protocol/openid-connect/token',
          configure: (proxy: any) => {
            const clientId = env.OPENSKY_CLIENT_ID ?? env.VITE_OPENSKY_CLIENT_ID ?? ''
            const clientSecret = env.OPENSKY_CLIENT_SECRET ?? env.VITE_OPENSKY_CLIENT_SECRET ?? ''
            proxy.on('proxyReq', (proxyReq: any, req: any) => {
              if (req.method === 'POST' && clientId && clientSecret) {
                const body = new URLSearchParams({
                  grant_type: 'client_credentials',
                  client_id: clientId,
                  client_secret: clientSecret,
                }).toString()
                proxyReq.setHeader('Content-Type', 'application/x-www-form-urlencoded')
                proxyReq.setHeader('Content-Length', Buffer.byteLength(body))
                proxyReq.write(body)
              }
            })
          },
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
        // CCTV is handled by vite-plugin-cctv-proxy (custom middleware)
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
