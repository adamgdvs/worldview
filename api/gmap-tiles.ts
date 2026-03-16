// Vercel edge proxy for Google Map Tiles API
// Keeps VITE_GOOGLE_MAPS_API_KEY server-side

export const config = { runtime: 'edge' }

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const upstreamPath = url.pathname.replace(/^\/gmap-tiles/, '')
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

  // Merge existing query params and append key
  const params = new URLSearchParams(url.search)
  params.set('key', key)

  const upstreamUrl = `https://tile.googleapis.com${upstreamPath}?${params.toString()}`

  const headers = new Headers(req.headers)
  headers.delete('host')

  const res = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    // @ts-ignore — duplex needed for streaming body in edge runtime
    duplex: req.method !== 'GET' && req.method !== 'HEAD' ? 'half' : undefined,
  })

  const responseHeaders = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v)
  }
  responseHeaders.delete('content-encoding')

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  })
}
