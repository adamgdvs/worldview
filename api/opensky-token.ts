import { proxyRequest } from './_lib/proxy'

export const config = { runtime: 'edge' }

export default (req: Request) =>
  proxyRequest(req, {
    upstream: 'https://auth.opensky-network.org',
    prefix: '/opensky-token',
    fixedPath: '/auth/realms/opensky-network/protocol/openid-connect/token',
  })
