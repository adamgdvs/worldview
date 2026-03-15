// OpenAQ v3 API — no API key required for basic access
// Fetches latest PM2.5 measurements from monitoring stations worldwide

export interface AQStation {
  id: number
  name: string
  latitude: number
  longitude: number
  pm25: number        // µg/m³
  aqi: number         // US EPA AQI derived from PM2.5
  parameter: string   // 'pm25'
  lastUpdated: string
  country: string
}

// Convert PM2.5 µg/m³ to US EPA AQI
function pm25ToAQI(pm: number): number {
  const bp: [number, number, number, number][] = [
    [0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ]
  for (const [cLo, cHi, iLo, iHi] of bp) {
    if (pm >= cLo && pm <= cHi) {
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (pm - cLo) + iLo)
    }
  }
  return pm > 500 ? 500 : 0
}

// AQI → color hex
export function aqiColor(aqi: number): string {
  if (aqi <= 50)  return '#36D977'   // Good — green
  if (aqi <= 100) return '#D4A017'   // Moderate — gold
  if (aqi <= 150) return '#D97736'   // Unhealthy for sensitive — orange
  if (aqi <= 200) return '#DD4444'   // Unhealthy — red
  if (aqi <= 300) return '#9966FF'   // Very unhealthy — purple
  return '#7E0023'                    // Hazardous — maroon
}

/**
 * Fetch latest PM2.5 readings worldwide from OpenAQ v3.
 * Returns up to `limit` stations with valid coordinates.
 */
export async function fetchAirQuality(limit = 1000): Promise<AQStation[]> {
  try {
    // OpenAQ v3 latest measurements endpoint — PM2.5 only
    const url = `https://api.openaq.org/v3/locations?limit=${limit}&parameter_id=2&order_by=lastUpdated&sort_order=desc`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      console.warn(`[AirQ] HTTP ${res.status}`)
      return []
    }

    const data = await res.json()
    const results: AQStation[] = []

    for (const loc of (data.results ?? [])) {
      const coords = loc.coordinates
      if (!coords?.latitude || !coords?.longitude) continue

      // Find PM2.5 parameter
      const pm25Param = loc.sensors?.find((s: any) =>
        s.parameter?.name === 'pm25' || s.parameter?.id === 2
      )

      // Use the latest value from the location summary if available
      const latestValue = pm25Param?.summary?.last?.value
        ?? loc.parameters?.find((p: any) => p.id === 2 || p.name === 'pm25')?.lastValue
        ?? null

      if (latestValue == null || latestValue < 0) continue

      const pm25 = Math.round(latestValue * 10) / 10
      results.push({
        id: loc.id,
        name: loc.name ?? `Station ${loc.id}`,
        latitude: coords.latitude,
        longitude: coords.longitude,
        pm25,
        aqi: pm25ToAQI(pm25),
        parameter: 'pm25',
        lastUpdated: loc.datetimeLast?.utc ?? '',
        country: loc.country?.code ?? '',
      })
    }

    console.info(`[AirQ] Loaded ${results.length} stations`)
    return results
  } catch (err) {
    console.error('[AirQ] Fetch failed:', err)
    return []
  }
}
