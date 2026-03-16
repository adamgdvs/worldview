import { proxyRequest } from './_lib/proxy'

export const config = { runtime: 'edge' }

export default (req: Request) =>
  proxyRequest(req, {
    upstream: 'https://api.windy.com',
    prefix: '/windy',
    extraHeaders: {
      'x-windy-api-key': process.env.VITE_WINDY_WEBCAMS_KEY ?? '',
    },
  })
