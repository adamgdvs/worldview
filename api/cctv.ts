// CCTV camera aggregator — Vercel Edge Function
// Mirrors vite-plugin-cctv-proxy.ts for production: fetches TfL JamCams,
// Austin TX, and (optionally) Transport NSW, merges + caches 5 min.
// GET /api/cctv?country=GB&source=tfl

export const config = { runtime: 'edge' }

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
  meta: ReturnType<typeof buildMeta>
  ts: number
}

const CACHE_TTL = 5 * 60_000
let cache: CacheEntry | null = null

function parseTfL(data: any[]): CameraFeed[] {
  return data
    .filter((c: any) => c.lat != null && c.lon != null)
    .map((c: any) => {
      const props = (c.additionalProperties ?? []) as Array<{ key: string; value: string }>
      const imageUrl = props.find((p) => p.key === 'imageUrl')?.value ?? ''
      const videoUrl = props.find((p) => p.key === 'videoUrl')?.value
      const view = props.find((p) => p.key === 'view')?.value
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

async function fetchTfL(): Promise<CameraFeed[]> {
  try {
    const res = await fetch('https://api.tfl.gov.uk/Place/Type/JamCam', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    return parseTfL(await res.json() as any[])
  } catch { return [] }
}

async function fetchAustin(): Promise<CameraFeed[]> {
  try {
    const res = await fetch('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=2000', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    return parseAustin(await res.json() as any[])
  } catch { return [] }
}

async function fetchNSW(apiKey: string): Promise<CameraFeed[]> {
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.transport.nsw.gov.au/v1/live/cameras', {
      headers: { Authorization: `apikey ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    return parseTfNSW(await res.json())
  } catch { return [] }
}

function buildMeta(cameras: CameraFeed[]) {
  const countries = new Map<string, { code: string; name: string; flag: string; count: number }>()
  const FLAGS: Record<string, string> = { GB: '🇬🇧', US: '🇺🇸', AU: '🇦🇺' }
  for (const c of cameras) {
    const e = countries.get(c.country) ?? { code: c.country, name: c.countryName, flag: FLAGS[c.country] ?? '', count: 0 }
    e.count++
    countries.set(c.country, e)
  }
  return {
    totalCameras: cameras.length,
    onlineCameras: cameras.filter(c => c.available).length,
    sources: [...new Set(cameras.map(c => c.source))],
    countries: [...countries.values()],
    lastUpdated: new Date().toISOString(),
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const nswKey = process.env.NSW_TRANSPORT_API_KEY ?? process.env.VITE_NSW_TRANSPORT_API_KEY ?? ''

  if (!cache || Date.now() - cache.ts >= CACHE_TTL) {
    const [tfl, austin, nsw] = await Promise.all([fetchTfL(), fetchAustin(), fetchNSW(nswKey)])
    const cameras = [...tfl, ...austin, ...nsw]
    cache = { cameras, meta: buildMeta(cameras), ts: Date.now() }
  }

  let filtered = cache.cameras
  const countryFilter = url.searchParams.get('country')
  const sourceFilter = url.searchParams.get('source')
  if (countryFilter && countryFilter !== 'ALL') filtered = filtered.filter(c => c.country === countryFilter)
  if (sourceFilter) filtered = filtered.filter(c => c.source === sourceFilter)

  return new Response(JSON.stringify({ cameras: filtered, meta: cache.meta }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // CDN-cache the aggregate — one origin fetch serves everyone for 5 min
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
    },
  })
}
