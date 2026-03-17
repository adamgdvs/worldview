// sensor.community (formerly Luftdaten) — completely free, no API key
// Fetches latest PM2.5/PM10 from ~20,000+ citizen science sensors worldwide

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
 * Fetch latest PM2.5 readings worldwide from sensor.community.
 * SDS011 sensors report P1 (PM10) and P2 (PM2.5).
 * Returns up to `limit` stations with valid coordinates.
 */
export async function fetchAirQuality(limit = 2000): Promise<AQStation[]> {
  try {
    // SDS011 is the most common PM sensor on sensor.community
    const res = await fetch('https://data.sensor.community/airrohr/v1/filter/type=SDS011', {
      signal: AbortSignal.timeout(30_000),
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      console.warn(`[AirQ] HTTP ${res.status}`)
      return []
    }

    const data = await res.json()
    if (!Array.isArray(data)) return []

    const results: AQStation[] = []
    const seen = new Set<string>()  // dedupe by location

    for (const entry of data) {
      if (results.length >= limit) break

      const loc = entry.location
      if (!loc?.latitude || !loc?.longitude) continue

      const lat = parseFloat(loc.latitude)
      const lon = parseFloat(loc.longitude)
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue

      // Deduplicate by rounded location (many sensors are co-located)
      const locKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
      if (seen.has(locKey)) continue
      seen.add(locKey)

      // Extract PM2.5 (P2) value from sensor data values
      const pm25Val = entry.sensordatavalues?.find(
        (v: any) => v.value_type === 'P2'
      )
      if (!pm25Val) continue

      const pm25 = parseFloat(pm25Val.value)
      if (isNaN(pm25) || pm25 < 0) continue

      results.push({
        id: entry.sensor?.id ?? results.length,
        name: `Sensor ${entry.sensor?.id ?? '?'}`,
        latitude: lat,
        longitude: lon,
        pm25: Math.round(pm25 * 10) / 10,
        aqi: pm25ToAQI(pm25),
        parameter: 'pm25',
        lastUpdated: entry.timestamp ?? '',
        country: loc.country ?? '',
      })
    }

    console.info(`[AirQ] Loaded ${results.length} stations from sensor.community`)
    return results
  } catch (err) {
    console.error('[AirQ] Fetch failed:', err)
    return []
  }
}
