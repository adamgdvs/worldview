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
  }
  location?: {
    city?: string
    country?: string
    latitude?: number
    longitude?: number
  }
}

/**
 * Fetch nearby webcams from Windy Webcams API v3.
 * Uses /windy proxy in dev (vite.config.ts) to inject the API key header.
 * In prod, we'd use a serverless function or edge proxy.
 */
async function fetchWindyWebcams(lat: number, lon: number, radiusKm = 25, limit = 15): Promise<CCTVFeed[]> {
  const apiKey = import.meta.env.VITE_WINDY_WEBCAMS_KEY
  if (!apiKey || apiKey.includes('your_')) {
    console.warn('[CCTV] No Windy Webcams API key (VITE_WINDY_WEBCAMS_KEY)')
    return []
  }

  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams` +
      `?nearby=${lat},${lon},${radiusKm}` +
      `&limit=${limit}` +
      `&include=images,location` +
      `&lang=en`

    const res = await fetch(url, {
      headers: { 'x-windy-api-key': apiKey },
    })

    if (!res.ok) {
      console.warn(`[CCTV] Windy API returned ${res.status}`)
      return []
    }

    const data = await res.json()
    const webcams: WindyWebcam[] = data?.webcams ?? []

    return webcams
      .filter(w => w.status === 'active' && w.images?.current && w.location?.latitude != null)
      .map(w => ({
        id: `windy-${w.webcamId}`,
        name: w.title || `Webcam ${w.webcamId}`,
        latitude: w.location!.latitude!,
        longitude: w.location!.longitude!,
        // Prefer preview > thumbnail > icon (ascending quality on free tier)
        imageUrl: w.images!.current!.preview ?? w.images!.current!.thumbnail ?? w.images!.current!.icon ?? '',
        refreshInterval: 5 * 60_000, // 5 min (free tier tokens expire at 10 min)
        source: `Windy · ${w.location?.city ?? w.location?.country ?? 'Unknown'}`,
        city: w.location?.city ?? '',
      }))
      .filter(f => f.imageUrl.length > 0)
  } catch (err) {
    console.error('[CCTV] Windy fetch failed:', err)
    return []
  }
}

/**
 * Get CCTV feeds for a city.
 * - Named city → nearby search around city center
 * - "Global" → returns feeds for all cities (cached)
 */
export async function getCCTVFeeds(city?: string): Promise<CCTVFeed[]> {
  if (!city || city === 'Global') {
    // For global view, fetch a sample from a few major cities
    const majorCities = ['New York', 'London', 'Tokyo', 'Paris', 'Dubai']
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
  try {
    const res = await fetch(feed.imageUrl, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    // Windy images may not be CORS-accessible directly; use as <img> src instead
    return feed.imageUrl
  }
}
