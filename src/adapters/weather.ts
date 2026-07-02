// Open-Meteo API — no API key required
// https://open-meteo.com/en/docs
// Fetches current weather for a dense global grid (~350 points, 10°×15° spacing)

export interface WeatherPoint {
  id: string
  latitude: number
  longitude: number
  temperature: number     // °C
  windSpeed: number       // km/h
  windDirection: number   // degrees
  weatherCode: number     // WMO code
  isDay: boolean
  precipitation: number   // mm
  cloudCover: number      // %
}

// WMO Weather Code → short label
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Cloudy'
  if (code <= 49) return 'Fog'
  if (code <= 59) return 'Drizzle'
  if (code <= 69) return 'Rain'
  if (code <= 79) return 'Snow'
  if (code <= 84) return 'Showers'
  if (code <= 86) return 'Snow Shw'
  if (code <= 99) return 'Thunder'
  return '?'
}

// Weather code → color for visualization
export function weatherColor(code: number): string {
  if (code === 0) return '#6699FF'          // clear — blue
  if (code <= 3) return '#8899AA'           // cloudy — gray-blue
  if (code <= 49) return '#AABBCC'          // fog — light gray
  if (code <= 69) return '#3388DD'          // rain/drizzle — blue
  if (code <= 79) return '#CCDDFF'          // snow — ice blue
  if (code <= 86) return '#99AADD'          // snow showers
  if (code <= 99) return '#FFD700'          // thunderstorm — gold
  return '#6699FF'
}

// Dense global grid: 10° lat × 15° lon = ~350 points
// Covers -60 to 70 lat (avoids Antarctica), -180 to 180 lon
function generateWorldGrid(): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = []
  for (let lat = -60; lat <= 70; lat += 10) {
    for (let lon = -180; lon <= 180; lon += 15) {
      points.push({ lat, lon })
    }
  }
  return points
}

/**
 * Fetch a single batch of locations from Open-Meteo.
 * Returns parsed WeatherPoints or empty array on failure.
 */
async function fetchBatch(
  batch: Array<{ lat: number; lon: number }>,
  signal: AbortSignal,
): Promise<WeatherPoint[]> {
  const lats = batch.map(p => p.lat).join(',')
  const lons = batch.map(p => p.lon).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,precipitation,cloud_cover` +
    `&forecast_days=1`

  const res = await fetch(url, { signal })
  if (!res.ok) {
    console.warn(`[Weather] HTTP ${res.status}`)
    return []
  }

  const data = await res.json()
  const entries = Array.isArray(data) ? data : [data]
  const results: WeatherPoint[] = []

  for (let j = 0; j < entries.length; j++) {
    const entry = entries[j]
    const c = entry?.current
    if (!c) continue

    const lat = entry.latitude ?? batch[j]?.lat
    const lon = entry.longitude ?? batch[j]?.lon
    if (lat == null || lon == null) continue

    results.push({
      id: `wx-${lat}-${lon}`,
      latitude: lat,
      longitude: lon,
      temperature: c.temperature_2m ?? 0,
      windSpeed: c.wind_speed_10m ?? 0,
      windDirection: c.wind_direction_10m ?? 0,
      weatherCode: c.weather_code ?? 0,
      isDay: c.is_day === 1,
      precipitation: c.precipitation ?? 0,
      cloudCover: c.cloud_cover ?? 0,
    })
  }

  return results
}

/**
 * Fetch current weather for a dense global grid (~350 points).
 * Uses concurrent requests (3 at a time) for speed while being
 * respectful of Open-Meteo's free tier.
 * Concurrent calls share one request and results are cached 5 min —
 * the grid costs ~15 API calls, so StrictMode double-effects would
 * otherwise trip Open-Meteo's burst limiter.
 */
let _wxInFlight: Promise<WeatherPoint[]> | null = null
let _wxCache: { data: WeatherPoint[]; at: number } | null = null

export async function fetchWeather(): Promise<WeatherPoint[]> {
  if (_wxCache && Date.now() - _wxCache.at < 5 * 60_000) return _wxCache.data
  if (_wxInFlight) return _wxInFlight
  _wxInFlight = fetchWeatherUncached().then(data => {
    if (data.length) _wxCache = { data, at: Date.now() }
    return data
  }).finally(() => { _wxInFlight = null })
  return _wxInFlight
}

async function fetchWeatherUncached(): Promise<WeatherPoint[]> {
  const grid = generateWorldGrid()
  const results: WeatherPoint[] = []
  const signal = AbortSignal.timeout(45_000)

  // Split into batches of 25 locations each (URL stays under limits)
  const batchSize = 25
  const batches: Array<Array<{ lat: number; lon: number }>> = []
  for (let i = 0; i < grid.length; i += batchSize) {
    batches.push(grid.slice(i, i + batchSize))
  }

  // Fetch with concurrency limit of 3
  const concurrency = 3
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency)
    const promises = chunk.map(batch => fetchBatch(batch, signal).catch(() => [] as WeatherPoint[]))
    const chunkResults = await Promise.all(promises)
    for (const r of chunkResults) results.push(...r)

    // Small delay between concurrent groups
    if (i + concurrency < batches.length) {
      await new Promise(r => setTimeout(r, 150))
    }
  }

  console.info(`[Weather] Loaded ${results.length} weather points`)
  return results
}
