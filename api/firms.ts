import { proxyRequest } from './_lib/proxy'

export const config = { runtime: 'edge' }

export default (req: Request) =>
  proxyRequest(req, {
    upstream: 'https://firms.modaps.eosdis.nasa.gov',
    prefix: '/firms',
  })
