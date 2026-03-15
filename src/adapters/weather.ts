// Open-Meteo API — no API key required
// Fetches current weather for a grid of points around the globe

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

// Grid of world lat/lon points for sampling weather data
function generateWorldGrid(latStep = 20, lonStep = 30): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = []
  for (let lat = -60; lat <= 70; lat += latStep) {
    for (let lon = -170; lon <= 170; lon += lonStep) {
      points.push({ lat, lon })
    }
  }
  return points
}

/**
 * Fetch current weather for a global grid of points.
 * Uses individual requests per point to avoid URL length issues.
 * Fetches in parallel with concurrency limit.
 */
export async function fetchWeather(): Promise<WeatherPoint[]> {
  const grid = generateWorldGrid(20, 30)  // ~84 points (coarser grid for reliability)
  const results: WeatherPoint[] = []

  // Fetch in small batches of 10 locations each (comma-separated lat/lon)
  const batchSize = 10
  for (let i = 0; i < grid.length; i += batchSize) {
    const batch = grid.slice(i, i + batchSize)
    try {
      const lats = batch.map(p => p.lat).join(',')
      const lons = batch.map(p => p.lon).join(',')
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lats}&longitude=${lons}` +
        `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,precipitation,cloud_cover` +
        `&forecast_days=1`

      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) {
        console.warn(`[Weather] HTTP ${res.status} for batch ${i}`)
        continue
      }

      const data = await res.json()

      // Open-Meteo returns an array for multi-location, object for single
      const entries = Array.isArray(data) ? data : [data]

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
    } catch (err) {
      console.warn(`[Weather] Batch ${i} fetch failed:`, err)
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < grid.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.info(`[Weather] Loaded ${results.length} weather points`)
  return results
}
