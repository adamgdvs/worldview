/**
 * Vite plugin that manually proxies WebSocket upgrades for /ais-ws
 * to wss://stream.aisstream.io/v0/stream.
 *
 * Vite's built-in ws:true proxy conflicts with its HMR WebSocket,
 * so we handle the upgrade ourselves using the `ws` package.
 */
import { type Plugin } from 'vite'
import { WebSocket as WsWebSocket, WebSocketServer, type RawData } from 'ws'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'

export default function aisWebSocketProxy(): Plugin {
  return {
    name: 'ais-websocket-proxy',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (req.url !== '/ais-ws') return // let Vite handle HMR and other paths

        console.log('[AIS proxy] WebSocket upgrade intercepted for /ais-ws')

        const upstream = new WsWebSocket('wss://stream.aisstream.io/v0/stream')

        upstream.on('open', () => {
          console.log('[AIS proxy] Connected to AISStream upstream')

          wss.handleUpgrade(req, socket, head, (browserWs) => {
            console.log('[AIS proxy] Browser WebSocket accepted')

            // Relay: browser → upstream
            browserWs.on('message', (data: RawData) => {
              if (upstream.readyState === WsWebSocket.OPEN) {
                upstream.send(data.toString())
              }
            })

            // Relay: upstream → browser
            upstream.on('message', (data: RawData) => {
              if (browserWs.readyState === WsWebSocket.OPEN) {
                browserWs.send(data.toString())
              }
            })

            browserWs.on('close', () => {
              console.log('[AIS proxy] Browser disconnected, closing upstream')
              upstream.close()
            })

            upstream.on('close', (code, reason) => {
              console.log(`[AIS proxy] Upstream closed (code: ${code}, reason: ${reason?.toString() || 'none'})`)
              if (browserWs.readyState === WsWebSocket.OPEN) {
                browserWs.close()
              }
            })

            upstream.on('error', (err) => {
              console.error('[AIS proxy] Upstream error:', err.message)
              browserWs.close()
            })

            browserWs.on('error', (err) => {
              console.error('[AIS proxy] Browser WS error:', err.message)
              upstream.close()
            })
          })
        })

        upstream.on('error', (err) => {
          console.error('[AIS proxy] Failed to connect upstream:', err.message)
          socket.destroy()
        })
      })
    },
  }
}
