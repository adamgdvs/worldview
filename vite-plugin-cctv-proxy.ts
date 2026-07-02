/**
 * Vite plugin: CCTV API aggregator + image proxy
 *
 * /api/cctv         — Fetches TfL, Austin TX, NSW cameras with 5-min cache
 * /api/cctv/image   — CORS image proxy (returns upstream image bytes)
 *
 * Env: VITE_NSW_TRANSPORT_API_KEY (optional — NSW source disabled without it)
 */
import { type Plugin, loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

// ── Types ────────────────────────────────────────────────────────────────────

interface CameraFeed {
  id: string
  name: string
  source: 'tfl' | 'austin' | 'tfnsw'
  country: string
  countryName: string
  region: string
  latitude: number
  longitude: number
  imageUrl: string
  videoUrl?: string
  available: boolean
  viewDirection?: string
  lastUpdated: string
}

interface CacheEntry {
  cameras: CameraFeed[]
  meta: { totalCameras: number; onlineCameras: number; sources: string[]; countries: any[]; lastUpdated: string }
  ts: number
}

const CACHE_TTL = 5 * 60_000 // 5 min
let cache: CacheEntry | null = null

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseTfL(data: any[]): CameraFeed[] {
  return data
    .filter((c: any) => c.lat != null && c.lon != null)
    .map((c: any) => {
      const props = (c.additionalProperties ?? []) as Array<{ key: string; value: string }>
      const imageUrl = props.find((p: any) => p.key === 'imageUrl')?.value ?? ''
      const videoUrl = props.find((p: any) => p.key === 'videoUrl')?.value
      const view = props.find((p: any) => p.key === 'view')?.value
      return {
        id: `tfl-${c.id}`,
        name: c.commonName ?? c.id,
        source: 'tfl' as const,
        country: 'GB',
        countryName: 'United Kingdom',
        region: 'London',
        latitude: c.lat,
        longitude: c.lon,
        imageUrl,
        videoUrl: videoUrl || undefined,
        available: imageUrl !== '',
        viewDirection: view,
        lastUpdated: new Date().toISOString(),
      }
    })
}

function parseAustin(data: any[]): CameraFeed[] {
  return data
    .filter((c: any) => c.location?.coordinates || (c.location_latitude && c.location_longitude))
    .map((c: any) => {
      // API returns location as GeoJSON Point: { type: "Point", coordinates: [lon, lat] }
      const lon = c.location?.coordinates?.[0] ?? parseFloat(c.location_longitude)
      const lat = c.location?.coordinates?.[1] ?? parseFloat(c.location_latitude)
      const imageUrl = c.screenshot_address
        ?? `https://cctv.austinmobility.io/image/${c.camera_id}.jpg`
      return {
        id: `austin-${c.camera_id}`,
        name: (c.location_name ?? c.camera_id).trim(),
        source: 'austin' as const,
        country: 'US',
        countryName: 'United States',
        region: 'Austin, TX',
        latitude: lat,
        longitude: lon,
        imageUrl,
        available: imageUrl !== '' && c.camera_status === 'TURNED_ON',
        lastUpdated: c.modified_date ?? new Date().toISOString(),
      }
    })
}

function parseTfNSW(data: any): CameraFeed[] {
  const features = data?.features ?? []
  return features
    .filter((f: any) => f.geometry?.coordinates)
    .map((f: any) => {
      const p = f.properties ?? {}
      const [lon, lat] = f.geometry.coordinates
      const imageUrl = p.href ?? ''
      return {
        id: `tfnsw-${p.id ?? f.id}`,
        name: p.title ?? p.name ?? `NSW Camera ${f.id}`,
        source: 'tfnsw' as const,
        country: 'AU',
        countryName: 'Australia',
        region: p.region ?? 'NSW',
        latitude: lat,
        longitude: lon,
        imageUrl,
        available: imageUrl !== '',
        viewDirection: p.direction,
        lastUpdated: new Date().toISOString(),
      }
    })
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchTfL(): Promise<CameraFeed[]> {
  try {
    const res = await fetch('https://api.tfl.gov.uk/Place/Type/JamCam', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn(`[CCTV] TfL ${res.status}`); return [] }
    return parseTfL(await res.json() as any[])
  } catch (e: any) {
    console.warn('[CCTV] TfL error:', e.message)
    return []
  }
}

async function fetchAustin(): Promise<CameraFeed[]> {
  try {
    const res = await fetch('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=2000', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn(`[CCTV] Austin ${res.status}`); return [] }
    return parseAustin(await res.json() as any[])
  } catch (e: any) {
    console.warn('[CCTV] Austin error:', e.message)
    return []
  }
}

async function fetchNSW(apiKey: string): Promise<CameraFeed[]> {
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.transport.nsw.gov.au/v1/live/cameras', {
      headers: { Authorization: `apikey ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn(`[CCTV] NSW ${res.status}`); return [] }
    return parseTfNSW(await res.json())
  } catch (e: any) {
    console.warn('[CCTV] NSW error:', e.message)
    return []
  }
}

function buildMeta(cameras: CameraFeed[]) {
  const countries = new Map<string, { code: string; name: string; flag: string; count: number }>()
  const FLAGS: Record<string, string> = { GB: '\uD83C\uDDEC\uD83C\uDDE7', US: '\uD83C\uDDFA\uD83C\uDDF8', AU: '\uD83C\uDDE6\uD83C\uDDFA' }
  for (const c of cameras) {
    const e = countries.get(c.country) ?? { code: c.country, name: c.countryName, flag: FLAGS[c.country] ?? '', count: 0 }
    e.count++
    countries.set(c.country, e)
  }
  const online = cameras.filter(c => c.available).length
  const sources = [...new Set(cameras.map(c => c.source))]
  return {
    totalCameras: cameras.length,
    onlineCameras: online,
    sources,
    countries: [...countries.values()],
    lastUpdated: new Date().toISOString(),
  }
}

async function getAllCameras(nswKey: string): Promise<CacheEntry> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache

  const [tfl, austin, nsw] = await Promise.all([fetchTfL(), fetchAustin(), fetchNSW(nswKey)])
  const cameras = [...tfl, ...austin, ...nsw]
  const meta = buildMeta(cameras)
  cache = { cameras, meta, ts: Date.now() }
  console.info(`[CCTV] Fetched ${cameras.length} cameras (TfL=${tfl.length}, Austin=${austin.length}, NSW=${nsw.length})`)
  return cache
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default function cctvProxy(): Plugin {
  return {
    name: 'cctv-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '')
      const nswKey = env.VITE_NSW_TRANSPORT_API_KEY ?? ''

      // /api/cctv — JSON camera list
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Function) => {
        if (req.url?.startsWith('/api/cctv/image')) return next() // handled below
        if (!req.url?.startsWith('/api/cctv')) return next()

        try {
          const url = new URL(req.url, 'http://localhost')
          const countryFilter = url.searchParams.get('country')
          const sourceFilter = url.searchParams.get('source')

          const { cameras, meta } = await getAllCameras(nswKey)

          let filtered = cameras
          if (countryFilter && countryFilter !== 'ALL') {
            filtered = filtered.filter(c => c.country === countryFilter)
          }
          if (sourceFilter) {
            filtered = filtered.filter(c => c.source === sourceFilter)
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
          })
          res.end(JSON.stringify({ cameras: filtered, meta }))
        } catch (err: any) {
          console.error('[CCTV] API error:', err.message)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })

      // /api/cctv/image?url=<encoded> — CORS image proxy
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Function) => {
        if (!req.url?.startsWith('/api/cctv/image')) return next()

        try {
          const url = new URL(req.url, 'http://localhost')
          const imageUrl = url.searchParams.get('url')

          if (!imageUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing url parameter' }))
            return
          }

          const upstream = await fetch(imageUrl, {
            signal: AbortSignal.timeout(10_000),
            headers: {
              'User-Agent': 'worldview/1.0',
              Accept: 'image/*',
            },
          })

          if (!upstream.ok) {
            res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }))
            return
          }

          const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
          const buffer = Buffer.from(await upstream.arrayBuffer())

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=60',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': buffer.length,
          })
          res.end(buffer)
        } catch (err: any) {
          console.error('[CCTV] Image proxy error:', err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}
