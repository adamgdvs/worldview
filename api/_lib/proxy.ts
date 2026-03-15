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
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function proxyRequest(req: Request, config: ProxyConfig): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const upstreamPath = config.fixedPath
    ?? url.pathname.replace(new RegExp(`^${config.prefix}`), '')
  const upstreamUrl = `${config.upstream}${upstreamPath}${url.search}`

  // Forward the request
  const headers = new Headers(req.headers)
  headers.delete('host')
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
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
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
