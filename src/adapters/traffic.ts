import { get, set } from 'idb-keyval'

export interface RoadSegment {
  id: string
  coordinates: [number, number][]  // [lon, lat][]
  roadClass: string
  oneway: boolean
  name: string
}

interface CacheEntry {
  segments: RoadSegment[]
  timestamp: number
}

const CACHE_TTL = 24 * 60 * 60_000 // 24 hours
const MIN_FETCH_INTERVAL = 15_000  // minimum 15s between Overpass requests
const MAX_RETRIES = 2
const RETRY_DELAY = 5_000 // 5s between retries

// Overpass API servers — try alternate on failure/timeout
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

let lastFetchTime = 0
let lastFetchedSegments: RoadSegment[] = []  // keep last successful result as fallback

// Bounding boxes per city (south, west, north, east)
const CITY_BBOX: Record<string, [number, number, number, number]> = {
  'Austin':        [30.18, -97.85, 30.40, -97.65],
  'New York':      [40.65, -74.05, 40.82, -73.90],
  'Tokyo':         [35.60, 139.60, 35.75, 139.80],
  'London':        [51.45, -0.20,  51.55,  0.00],
  'Paris':         [48.82,  2.28,  48.90,  2.42],
  'Dubai':         [25.10,  55.15, 25.30,  55.35],
  'Washington DC': [38.85, -77.10, 38.95, -76.95],
  'San Francisco': [37.72, -122.50, 37.82, -122.38],
  'Hong Kong':     [22.26, 114.10, 22.36, 114.24],
  'Singapore':     [1.28,  103.76, 1.38,  103.88],
}

function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox
  return `[out:json][timeout:30];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${s},${w},${n},${e});
);
out geom;`
}

function parseOverpassResponse(data: any): RoadSegment[] {
  const segments: RoadSegment[] = []
  if (!data?.elements) return segments

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue
    const coords: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat])
    if (coords.length < 2) continue

    segments.push({
      id: String(el.id),
      coordinates: coords,
      roadClass: el.tags?.highway ?? 'secondary',
      oneway: el.tags?.oneway === 'yes',
      name: el.tags?.name ?? '',
    })
  }

  return segments
}

export async function fetchRoadNetwork(city: string): Promise<RoadSegment[]> {
  if (city === 'Global' || !CITY_BBOX[city]) return []
  return fetchRoadNetworkByBbox(CITY_BBOX[city], city)
}

/** Fetch roads for an arbitrary bounding box [south, west, north, east] */
export async function fetchRoadNetworkByBbox(
  bbox: [number, number, number, number],
  label?: string,
): Promise<RoadSegment[]> {
  // Clamp bbox size to avoid huge Overpass queries — cap to center 0.8°
  let [s, w, n, e] = bbox
  let latSpan = n - s
  let lonSpan = e - w

  const MAX_SPAN = 0.8
  if (latSpan > MAX_SPAN) {
    const mid = (s + n) / 2
    s = mid - MAX_SPAN / 2; n = mid + MAX_SPAN / 2
    latSpan = MAX_SPAN
  }
  if (lonSpan > MAX_SPAN) {
    const mid = (w + e) / 2
    w = mid - MAX_SPAN / 2; e = mid + MAX_SPAN / 2
    lonSpan = MAX_SPAN
  }

  console.debug(`[Traffic] Query bbox: ${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)} (${latSpan.toFixed(2)}°×${lonSpan.toFixed(2)}°)`)

  // Round bbox to 2 decimal places for cache key stability
  const cacheKey = `worldview-roads-${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}`

  // Check IndexedDB cache (skip empty cached results)
  try {
    const cached = await get<CacheEntry>(cacheKey)
    if (cached && cached.segments.length > 0 && Date.now() - cached.timestamp < CACHE_TTL) {
      console.debug(`[Traffic] Cache hit for ${label ?? 'bbox'} (${cached.segments.length} segments)`)
      lastFetchedSegments = cached.segments
      return cached.segments
    }
  } catch { /* cache miss */ }

  // Throttle: don't hammer Overpass — return last result if too soon
  const now = Date.now()
  if (now - lastFetchTime < MIN_FETCH_INTERVAL) {
    console.debug(`[Traffic] Throttled — returning ${lastFetchedSegments.length} cached segments`)
    return lastFetchedSegments
  }

  const query = buildOverpassQuery([s, w, n, e])

  // Try each Overpass mirror in order
  for (let si = 0; si < OVERPASS_SERVERS.length; si++) {
    const server = OVERPASS_SERVERS[si]
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * attempt))
        }

        console.debug(`[Traffic] Fetching road network for ${label ?? 'bbox'} (server ${si + 1}/${OVERPASS_SERVERS.length})...`)
        lastFetchTime = Date.now()
        const res = await fetch(server, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(25_000),
        })

        if (res.status === 429 || res.status === 504 || res.status === 503) {
          console.warn(`[Traffic] Overpass returned ${res.status}`)
          if (attempt < MAX_RETRIES) continue
          break // try next server
        }

        if (!res.ok) {
          console.warn(`[Traffic] Overpass returned ${res.status}`)
          break // try next server
        }

        const data = await res.json()
        const segments = parseOverpassResponse(data)
        console.debug(`[Traffic] Got ${segments.length} road segments for ${label ?? 'bbox'}`)

        lastFetchedSegments = segments

        // Cache in IndexedDB (only cache non-empty results)
        if (segments.length > 0) {
          try {
            await set(cacheKey, { segments, timestamp: Date.now() } as CacheEntry)
          } catch { /* cache write failure, non-critical */ }
        }

        return segments
      } catch (err) {
        console.warn(`[Traffic] Overpass server ${si + 1} failed:`, (err as Error).message)
        if (attempt >= MAX_RETRIES) break // try next server
      }
    }
  }

  console.warn(`[Traffic] All Overpass servers exhausted, returning ${lastFetchedSegments.length} cached segments`)
  return lastFetchedSegments
}
