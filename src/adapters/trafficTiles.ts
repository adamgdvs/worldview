// Google Map Tiles API — session management + pixel-based traffic data sampler

interface SessionResult {
  session: string
  expiry: number // ms timestamp
}

/** POST to Google Map Tiles createSession (proxied via /gmap-tiles) */
export async function createTrafficSession(): Promise<SessionResult> {
  const res = await fetch('/gmap-tiles/v1/createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mapType: 'roadmap',
      language: 'en-US',
      region: 'US',
      layerTypes: ['layerTraffic'],
      overlay: true,
      imageFormat: 'png',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`createSession failed: ${res.status} — ${text}`)
  }
  const data = await res.json()
  console.info('[TrafficTiles] createSession response:', data)
  // Google returns expiry as seconds since epoch (string)
  const expiry = data.expiry
    ? Number(data.expiry) * 1000
    : Date.now() + 14 * 24 * 60 * 60_000 // default 14 days
  return { session: data.session, expiry }
}

/** Build a proxied tile URL for CesiumJS UrlTemplateImageryProvider */
export function getTrafficTileUrl(session: string): string {
  return `/gmap-tiles/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&overlay=true`
}

// ─── Pixel-based Traffic Data Sampler ────────────────────────────────────────

interface TileCacheEntry {
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  lastUsed: number
}

const TILE_SIZE = 256
const MAX_CACHED_TILES = 50

/** Convert lat/lon to tile x,y at a given zoom level (Web Mercator) */
function latLonToTile(lat: number, lon: number, zoom: number): { tx: number; ty: number; px: number; py: number } {
  const n = 1 << zoom
  const tx = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const ty = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  // Pixel within tile
  const xFrac = (((lon + 180) / 360) * n) - tx
  const yFrac = (((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n) - ty
  const px = Math.floor(xFrac * TILE_SIZE)
  const py = Math.floor(yFrac * TILE_SIZE)
  return { tx, ty, px: Math.min(px, TILE_SIZE - 1), py: Math.min(py, TILE_SIZE - 1) }
}

/** Map pixel RGB to a traffic level 0→1 (0=jammed, 1=free-flow) */
function rgbToTrafficLevel(r: number, g: number, b: number, a: number): number | null {
  // Transparent = no traffic data
  if (a < 30) return null

  // Classify by dominant color channel
  // Dark red / maroon (extreme congestion)
  if (r > 100 && g < 60 && b < 60) return 0.1
  // Red (heavy traffic)
  if (r > 180 && g < 100 && b < 100) return 0.15
  // Orange (moderate-heavy)
  if (r > 180 && g > 80 && g < 170 && b < 80) return 0.35
  // Yellow (moderate)
  if (r > 200 && g > 170 && b < 100) return 0.5
  // Green (free flow)
  if (g > 100 && r < 150 && b < 150) return 1.0
  // Blue/teal (Google sometimes uses for normal flow)
  if (b > 100 && r < 100) return 0.85

  return null // unrecognized
}

export class TrafficDataSampler {
  private cache = new Map<string, TileCacheEntry>()
  private pending = new Map<string, Promise<TileCacheEntry | null>>()
  private session: string

  constructor(session: string) {
    this.session = session
  }

  updateSession(session: string) {
    this.session = session
  }

  /** Sample traffic level at lat/lon. Returns 0-1 or null if no data. */
  sampleTrafficLevel(lat: number, lon: number, zoom = 12): number | null {
    const { tx, ty, px, py } = latLonToTile(lat, lon, zoom)
    const key = `${zoom}/${tx}/${ty}`

    const entry = this.cache.get(key)
    if (entry) {
      entry.lastUsed = Date.now()
      const pixel = entry.ctx.getImageData(px, py, 1, 1).data
      return rgbToTrafficLevel(pixel[0], pixel[1], pixel[2], pixel[3])
    }

    // Trigger async load if not already pending
    if (!this.pending.has(key)) {
      this.pending.set(key, this.loadTile(zoom, tx, ty, key))
    }

    return null // not yet loaded
  }

  private async loadTile(zoom: number, tx: number, ty: number, key: string): Promise<TileCacheEntry | null> {
    try {
      const url = `/gmap-tiles/v1/2dtiles/${zoom}/${tx}/${ty}?session=${encodeURIComponent(this.session)}&overlay=true`
      const res = await fetch(url)
      if (!res.ok) return null

      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      bmp.close()

      const entry: TileCacheEntry = { canvas, ctx, lastUsed: Date.now() }

      // Evict oldest if over limit
      if (this.cache.size >= MAX_CACHED_TILES) {
        let oldestKey = ''
        let oldestTime = Infinity
        for (const [k, v] of this.cache) {
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed
            oldestKey = k
          }
        }
        if (oldestKey) this.cache.delete(oldestKey)
      }

      this.cache.set(key, entry)
      return entry
    } catch {
      return null
    } finally {
      this.pending.delete(key)
    }
  }

  /** Clear all cached tiles */
  clear() {
    this.cache.clear()
    this.pending.clear()
  }
}
