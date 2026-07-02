// Shared edge proxy helper for Vercel Serverless Functions
// Strips a path prefix, forwards the request to an upstream, and adds CORS headers.

export interface ProxyConfig {
  /** Base URL of the upstream service (e.g. "https://opensky-network.org") */
  upstream: string
  /** Path prefix to strip from the incoming request (e.g. "/opensky") */
  prefix: string
  /** Fixed upstream path override — ignores the incoming path entirely */
  fixedPath?: string
  /** Extra headers to inject into the upstream request */
  extraHeaders?: Record<string, string>
  /** If true, strip Authorization header from the forwarded request (use when credentials are injected server-side) */
  stripAuth?: boolean
}

// Allowed origins — restrict to our own domains
const ALLOWED_ORIGINS = new Set([
  'https://worldview.app',
  'https://www.worldview.app',
  'http://localhost:5173',
  'http://localhost:4173',
])

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? ''
  // Allow configured origins and any Vercel preview deploys
  if (ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app')) {
    return origin
  }
  // Default to production domain (blocks cross-origin reads for unrecognized origins)
  return 'https://worldview.app'
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

export async function proxyRequest(req: Request, config: ProxyConfig): Promise<Response> {
  const cors = corsHeaders(req)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  const url = new URL(req.url)
  const upstreamPath = config.fixedPath
    ?? url.pathname.replace(new RegExp(`^${config.prefix}`), '')
  const upstreamUrl = `${config.upstream}${upstreamPath}${url.search}`

  // Forward the request — strip sensitive headers
  const headers = new Headers(req.headers)
  headers.delete('host')
  headers.delete('origin')
  headers.delete('referer')
  if (config.stripAuth) {
    headers.delete('authorization')
  }
  if (config.extraHeaders) {
    for (const [k, v] of Object.entries(config.extraHeaders)) {
      headers.set(k, v)
    }
  }

  const res = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    // @ts-ignore — duplex needed for streaming body in edge runtime
    duplex: req.method !== 'GET' && req.method !== 'HEAD' ? 'half' : undefined,
  })

  // Build response with CORS headers
  const responseHeaders = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) {
    responseHeaders.set(k, v)
  }
  // Remove headers that break edge streaming
  responseHeaders.delete('content-encoding')

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  })
}
