// OpenSky OAuth2 token endpoint — exchanges credentials SERVER-SIDE
// Client calls POST /opensky-token with no body; credentials come from env vars.

import { proxyRequest } from './_lib/proxy'

export const config = { runtime: 'edge' }

export default async (req: Request) => {
  // Only allow POST
  if (req.method === 'OPTIONS') {
    return proxyRequest(req, {
      upstream: 'https://auth.opensky-network.org',
      prefix: '/opensky-token',
      fixedPath: '/auth/realms/opensky-network/protocol/openid-connect/token',
    })
  }

  const clientId = process.env.OPENSKY_CLIENT_ID ?? ''
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET ?? ''

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'OpenSky credentials not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Build the token request with server-side credentials
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const modifiedReq = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })

  return proxyRequest(modifiedReq, {
    upstream: 'https://auth.opensky-network.org',
    prefix: '/opensky-token',
    fixedPath: '/auth/realms/opensky-network/protocol/openid-connect/token',
    stripAuth: true,
  })
}
