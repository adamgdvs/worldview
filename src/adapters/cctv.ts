export interface CCTVFeed {
  id: string
  name: string
  latitude: number
  longitude: number
  imageUrl: string
  refreshInterval: number  // ms
  source: string
  city: string
}

// City center coordinates for nearby searches (matches App.tsx CITY_FALLBACKS)
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'Austin':        { lat: 30.2672, lon: -97.7431 },
  'New York':      { lat: 40.7128, lon: -74.0060 },
  'Tokyo':         { lat: 35.6762, lon: 139.6503 },
  'London':        { lat: 51.5074, lon: -0.1278 },
  'Paris':         { lat: 48.8566, lon: 2.3522 },
  'Dubai':         { lat: 25.2048, lon: 55.2708 },
  'Washington DC': { lat: 38.9072, lon: -77.0369 },
  'San Francisco': { lat: 37.7749, lon: -122.4194 },
  'Hong Kong':     { lat: 22.3193, lon: 114.1694 },
  'Singapore':     { lat: 1.3521, lon: 103.8198 },
}

// In-memory cache: city → feeds (avoid re-fetching on toggle)
const feedCache = new Map<string, { feeds: CCTVFeed[]; timestamp: number }>()
const CACHE_TTL = 8 * 60_000 // 8 min (token expiry is 10 min on free tier)

interface WindyWebcam {
  webcamId: number
  title: string
  status: string
  images?: {
    current?: {
      icon?: string
      preview?: string
      thumbnail?: string
    }
    sizes?: Record<string, { width: number; height: number }>
  }
  location?: {
    city?: string
    region?: string
    country?: string
    latitude?: number
    longitude?: number
  }
}

/**
 * Fetch nearby webcams from Windy Webcams API v3 via our proxy.
 * API key is injected server-side by vite proxy (dev) or Vercel edge function (prod).
 */
async function fetchWindyWebcams(lat: number, lon: number, radiusKm = 25, limit = 15): Promise<CCTVFeed[]> {
  try {
    // Use our proxy which injects the API key server-side
    const url = `/windy/webcams/api/v3/webcams` +
      `?nearby=${lat},${lon},${radiusKm}` +
      `&limit=${limit}` +
      `&include=images,location` +
      `&lang=en`

    console.info(`[CCTV] Fetching webcams near ${lat.toFixed(2)},${lon.toFixed(2)}...`)

    const res = await fetch(url)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[CCTV] Windy API returned ${res.status}: ${text.slice(0, 200)}`)
      return []
    }

    const data = await res.json()
    console.info('[CCTV] Windy response:', data)

    // v3 response: { webcams: [...] } at top level
    const webcams: WindyWebcam[] = data?.webcams ?? data?.data?.webcams ?? []

    if (!webcams.length) {
      console.warn('[CCTV] No webcams in response')
      return []
    }

    const feeds = webcams
      .filter(w => w.status === 'active' && w.location?.latitude != null)
      .map(w => {
        // Get best available image URL
        const cur = w.images?.current
        const imageUrl = cur?.preview ?? cur?.thumbnail ?? cur?.icon ?? ''

        return {
          id: `windy-${w.webcamId}`,
          name: w.title || `Webcam ${w.webcamId}`,
          latitude: w.location!.latitude!,
          longitude: w.location!.longitude!,
          imageUrl,
          refreshInterval: 5 * 60_000, // 5 min
          source: `Windy · ${w.location?.city ?? w.location?.region ?? w.location?.country ?? 'Unknown'}`,
          city: w.location?.city ?? '',
        }
      })

    console.info(`[CCTV] Parsed ${feeds.length} active webcams (${feeds.filter(f => f.imageUrl).length} with images)`)
    return feeds
  } catch (err) {
    console.error('[CCTV] Windy fetch failed:', err)
    return []
  }
}

/**
 * Get CCTV feeds for a city.
 * - Named city → nearby search around city center
 * - "Global" → returns feeds for a few major cities
 */
export async function getCCTVFeeds(city?: string): Promise<CCTVFeed[]> {
  if (!city || city === 'Global') {
    const majorCities = ['New York', 'London', 'Tokyo', 'Paris']
    const all: CCTVFeed[] = []
    for (const c of majorCities) {
      const feeds = await getCCTVFeedsForCity(c)
      all.push(...feeds)
    }
    return all
  }
  return getCCTVFeedsForCity(city)
}

async function getCCTVFeedsForCity(city: string): Promise<CCTVFeed[]> {
  // Check cache
  const cached = feedCache.get(city)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.feeds
  }

  const coords = CITY_COORDS[city]
  if (!coords) return []

  const feeds = await fetchWindyWebcams(coords.lat, coords.lon, 20, 15)
  feedCache.set(city, { feeds, timestamp: Date.now() })

  console.info(`[CCTV] ${feeds.length} webcams near ${city}`)
  return feeds
}

export async function fetchCCTVSnapshot(feed: CCTVFeed): Promise<string | null> {
  if (!feed.imageUrl) return null
  try {
    const res = await fetch(feed.imageUrl, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    // Windy image tokens may not be CORS-accessible; return raw URL for img.src fallback
    return feed.imageUrl
  }
}
