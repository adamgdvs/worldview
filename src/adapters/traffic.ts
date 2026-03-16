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
  // Clamp bbox size to avoid huge Overpass queries
  const [s, w, n, e] = bbox
  const latSpan = n - s
  const lonSpan = e - w
  if (latSpan > 0.5 || lonSpan > 0.5) {
    console.info(`[Traffic] Bbox too large (${latSpan.toFixed(2)}°×${lonSpan.toFixed(2)}°), skipping Overpass`)
    return []
  }

  // Round bbox to 2 decimal places for cache key stability
  const cacheKey = `worldview-roads-${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}`

  // Check IndexedDB cache
  try {
    const cached = await get<CacheEntry>(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.info(`[Traffic] Cache hit for ${label ?? 'bbox'} (${cached.segments.length} segments)`)
      return cached.segments
    }
  } catch { /* cache miss */ }

  const query = buildOverpassQuery(bbox)

  try {
    console.info(`[Traffic] Fetching road network for ${label ?? 'bbox'}...`)
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    if (!res.ok) {
      console.warn(`[Traffic] Overpass returned ${res.status}`)
      return []
    }

    const data = await res.json()
    const segments = parseOverpassResponse(data)
    console.info(`[Traffic] Got ${segments.length} road segments for ${label ?? 'bbox'}`)

    // Cache in IndexedDB
    try {
      await set(cacheKey, { segments, timestamp: Date.now() } as CacheEntry)
    } catch { /* cache write failure, non-critical */ }

    return segments
  } catch (err) {
    console.error('[Traffic] Overpass fetch failed:', err)
    return []
  }
}
