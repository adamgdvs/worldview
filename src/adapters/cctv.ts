export interface CCTVFeed {
  id: string
  webcamId: number
  name: string
  latitude: number
  longitude: number
  imageUrl: string        // preview URL (fetched lazily)
  refreshInterval: number // ms
  source: string
  city: string
}

// Global feed accumulator — once loaded, feeds persist for the session
const globalFeedMap = new Map<string, CCTVFeed>()
let globalLoadStarted = false
let globalLoadDone = false
let globalLoadListeners: Array<(feeds: CCTVFeed[]) => void> = []

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
    region?: string
    country?: string
    latitude?: number
    longitude?: number
  }
}

/**
 * Fetch webcams near a point from Windy v3 API.
 * Paginates up to `maxTotal` webcams (50 per page).
 */
async function fetchWindyNearby(
  lat: number, lon: number,
  radiusKm: number,
  maxTotal = 200,
): Promise<CCTVFeed[]> {
  const allFeeds: CCTVFeed[] = []
  let offset = 0
  const pageSize = 50

  while (offset < maxTotal) {
    try {
      const url = `/windy/webcams/api/v3/webcams` +
        `?nearby=${lat},${lon},${radiusKm}` +
        `&limit=${pageSize}&offset=${offset}` +
        `&include=location&lang=en`

      const res = await fetch(url)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[CCTV] Windy ${res.status}: ${text.slice(0, 200)}`)
        break
      }

      const data = await res.json()
      const webcams: WindyWebcam[] = data?.webcams ?? []

      if (!webcams.length) break

      for (const w of webcams) {
        if (w.status !== 'active' || w.location?.latitude == null) continue
        allFeeds.push({
          id: `windy-${w.webcamId}`,
          webcamId: w.webcamId,
          name: w.title || `Webcam ${w.webcamId}`,
          latitude: w.location!.latitude!,
          longitude: w.location!.longitude!,
          imageUrl: '',  // fetched lazily on click
          refreshInterval: 5 * 60_000,
          source: `Windy · ${w.location?.city ?? w.location?.region ?? w.location?.country ?? ''}`,
          city: w.location?.city ?? '',
        })
      }

      if (webcams.length < pageSize) break
      offset += pageSize
    } catch (err) {
      console.error('[CCTV] Windy fetch error:', err)
      break
    }
  }

  return allFeeds
}

// Grid points covering major populated areas worldwide (lat, lon)
// ~30 points × 250km radius ≈ covers most populated regions
const GLOBAL_GRID: [number, number][] = [
  // North America
  [40.7, -74.0], [34.0, -118.2], [41.9, -87.6], [29.8, -95.4], [37.8, -122.4],
  [33.4, -112.1], [47.6, -122.3], [25.8, -80.2], [38.9, -77.0], [43.7, -79.4],
  [45.5, -73.6], [19.4, -99.1],
  // Europe
  [51.5, -0.1], [48.9, 2.3], [52.5, 13.4], [40.4, -3.7], [41.9, 12.5],
  [59.3, 18.1], [55.8, 37.6], [50.1, 14.4], [47.5, 19.0], [52.2, 21.0],
  // Asia
  [35.7, 139.7], [37.6, 127.0], [31.2, 121.5], [22.3, 114.2], [1.3, 103.9],
  [13.8, 100.5], [28.6, 77.2], [25.2, 55.3], [41.0, 29.0],
  // South America
  [-23.5, -46.6], [-34.6, -58.4], [4.7, -74.1], [-12.0, -77.0],
  // Africa & Oceania
  [-33.9, 18.4], [30.0, 31.2], [-33.9, 151.2], [-36.8, 174.8],
]

/**
 * Load webcam locations globally — fires grid queries in parallel batches.
 * Returns all accumulated feeds. Subsequent calls return cached results immediately.
 */
export function loadGlobalCCTVFeeds(
  onProgress: (feeds: CCTVFeed[]) => void,
): () => void {
  // If already loaded, return immediately
  if (globalLoadDone) {
    onProgress(Array.from(globalFeedMap.values()))
    return () => {}
  }

  // Register listener for incremental updates
  globalLoadListeners.push(onProgress)

  // If load already in progress, just wait for callbacks
  if (globalLoadStarted) {
    // Send current accumulated data
    if (globalFeedMap.size > 0) {
      onProgress(Array.from(globalFeedMap.values()))
    }
    return () => {
      globalLoadListeners = globalLoadListeners.filter(l => l !== onProgress)
    }
  }

  globalLoadStarted = true
  console.info(`[CCTV] Starting global webcam load: ${GLOBAL_GRID.length} grid points`)

  // Fire queries in batches of 6 to avoid overwhelming the API
  const batchSize = 6
  let batchIndex = 0

  const runBatch = async () => {
    const start = batchIndex * batchSize
    const end = Math.min(start + batchSize, GLOBAL_GRID.length)
    if (start >= GLOBAL_GRID.length) {
      globalLoadDone = true
      console.info(`[CCTV] Global load complete: ${globalFeedMap.size} total webcams`)
      return
    }

    const batch = GLOBAL_GRID.slice(start, end)
    const promises = batch.map(([lat, lon]) =>
      fetchWindyNearby(lat, lon, 250, 200).catch(() => [] as CCTVFeed[])
    )

    const results = await Promise.all(promises)
    let added = 0
    for (const feeds of results) {
      for (const f of feeds) {
        if (!globalFeedMap.has(f.id)) {
          globalFeedMap.set(f.id, f)
          added++
        }
      }
    }

    if (added > 0) {
      const allFeeds = Array.from(globalFeedMap.values())
      console.info(`[CCTV] Batch ${batchIndex + 1}: +${added} webcams (total: ${allFeeds.length})`)
      for (const listener of globalLoadListeners) {
        listener(allFeeds)
      }
    }

    batchIndex++
    // Small delay between batches to be polite to the API
    setTimeout(runBatch, 500)
  }

  runBatch()

  return () => {
    globalLoadListeners = globalLoadListeners.filter(l => l !== onProgress)
  }
}

/**
 * Fetch the image for a specific webcam (on-click).
 * Returns a blob URL or raw image URL.
 */
export async function fetchCCTVSnapshot(feed: CCTVFeed): Promise<string | null> {
  // If we don't have an image URL yet, fetch it from Windy with images included
  let imageUrl = feed.imageUrl
  if (!imageUrl) {
    try {
      const res = await fetch(
        `/windy/webcams/api/v3/webcams/${feed.webcamId}?include=images&lang=en`
      )
      if (res.ok) {
        const data = await res.json()
        const cur = data?.images?.current
        imageUrl = cur?.preview ?? cur?.thumbnail ?? cur?.icon ?? ''
        feed.imageUrl = imageUrl // cache for next time
      }
    } catch { /* fall through */ }
  }

  if (!imageUrl) return null

  try {
    const res = await fetch(imageUrl, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return imageUrl // fallback to raw URL
  }
}
