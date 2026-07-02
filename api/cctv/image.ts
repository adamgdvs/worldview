// CCTV image proxy — Vercel Edge Function
// GET /api/cctv/image?url=<encoded camera image URL>
// Host-allowlisted so this is not an open proxy.

export const config = { runtime: 'edge' }

const ALLOWED_HOSTS = new Set([
  'jamcams.tfl.gov.uk',
  's3-eu-west-1.amazonaws.com',   // TfL JamCams bucket
  'cctv.austinmobility.io',
  'data.austintexas.gov',
])

function hostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host)
    || host.endsWith('.tfl.gov.uk')
    || host.endsWith('.transport.nsw.gov.au')
    || host.endsWith('.austinmobility.io')
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const imageUrl = url.searchParams.get('url')

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let target: URL
  try {
    target = new URL(imageUrl)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid url' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (target.protocol !== 'https:' || !hostAllowed(target.hostname)) {
    return new Response(JSON.stringify({ error: 'Host not allowed' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const upstream = await fetch(target.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'worldview/1.0', Accept: 'image/*' },
    })

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: upstream.status, headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
