/**
 * Vite plugin that proxies /spacetrack/* requests to space-track.org
 * with server-side cookie session management.
 *
 * Space-Track requires POST login to get a session cookie, then
 * subsequent GET requests must include that cookie. This plugin
 * handles auth transparently so the browser never sees credentials.
 *
 * Env vars: VITE_SPACETRACK_IDENTITY, VITE_SPACETRACK_PASSWORD
 */
import { type Plugin, loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

const BASE = 'https://www.space-track.org'
const LOGIN_URL = `${BASE}/ajaxauth/login`

let sessionCookie: string | null = null
let loginInFlight: Promise<boolean> | null = null

async function login(identity: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identity, password }).toString(),
      redirect: 'manual',
    })

    // Space-Track returns Set-Cookie on successful login
    const cookies = res.headers.getSetCookie?.() ?? []
    const chocolateChip = cookies.find(c => c.startsWith('chocolatechip='))
    if (chocolateChip) {
      sessionCookie = chocolateChip.split(';')[0]
      console.info('[SpaceTrack] Login successful, session acquired')
      return true
    }

    // Fallback: check raw set-cookie header
    const rawCookie = res.headers.get('set-cookie')
    if (rawCookie && rawCookie.includes('chocolatechip=')) {
      const match = rawCookie.match(/chocolatechip=[^;]+/)
      if (match) {
        sessionCookie = match[0]
        console.info('[SpaceTrack] Login successful (fallback parse)')
        return true
      }
    }

    const body = await res.text()
    console.warn(`[SpaceTrack] Login failed: HTTP ${res.status}`, body.slice(0, 200))
    return false
  } catch (err: any) {
    console.error('[SpaceTrack] Login error:', err.message)
    return false
  }
}

async function ensureLogin(identity: string, password: string): Promise<boolean> {
  if (sessionCookie) return true
  if (loginInFlight) return loginInFlight
  loginInFlight = login(identity, password).finally(() => { loginInFlight = null })
  return loginInFlight
}

export default function spaceTrackProxy(): Plugin {
  return {
    name: 'spacetrack-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '')
      const identity = env.VITE_SPACETRACK_IDENTITY ?? ''
      const password = env.VITE_SPACETRACK_PASSWORD ?? ''

      if (!identity || !password) {
        console.warn('[SpaceTrack] No VITE_SPACETRACK_IDENTITY/PASSWORD set — proxy disabled')
        return
      }

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Function) => {
        if (!req.url?.startsWith('/spacetrack/')) return next()

        const apiPath = req.url.replace(/^\/spacetrack/, '')
        const targetUrl = `${BASE}${apiPath}`

        // Ensure we have a valid session
        const loggedIn = await ensureLogin(identity, password)
        if (!loggedIn) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'SpaceTrack login failed' }))
          return
        }

        try {
          const upstream = await fetch(targetUrl, {
            headers: {
              Cookie: sessionCookie!,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(30_000),
          })

          // If 401, session expired — re-login and retry once
          if (upstream.status === 401) {
            console.info('[SpaceTrack] Session expired, re-authenticating...')
            sessionCookie = null
            const relogged = await ensureLogin(identity, password)
            if (!relogged) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'SpaceTrack re-login failed' }))
              return
            }
            const retry = await fetch(targetUrl, {
              headers: { Cookie: sessionCookie!, Accept: 'application/json' },
              signal: AbortSignal.timeout(30_000),
            })
            res.writeHead(retry.status, {
              'Content-Type': retry.headers.get('content-type') ?? 'application/json',
              'Access-Control-Allow-Origin': '*',
            })
            const retryBody = await retry.arrayBuffer()
            res.end(Buffer.from(retryBody))
            return
          }

          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          const body = await upstream.arrayBuffer()
          res.end(Buffer.from(body))
        } catch (err: any) {
          console.error('[SpaceTrack] Proxy error:', err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}
