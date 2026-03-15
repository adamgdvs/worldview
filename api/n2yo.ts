import { proxyRequest } from './_lib/proxy'

export const config = { runtime: 'edge' }

export default (req: Request) =>
  proxyRequest(req, {
    upstream: 'https://api.n2yo.com',
    prefix: '/n2yo',
  })
