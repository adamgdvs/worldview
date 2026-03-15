// USGS Earthquake Feed — no API key required
// GeoJSON: earthquake.usgs.gov/fdsnws/event/1/query

export interface SeismicEvent {
  id: string
  latitude: number
  longitude: number
  depth: number       // km
  magnitude: number
  place: string
  time: number        // Unix ms
}

export async function fetchSeismicEvents(minMag = 2.5, limit = 200): Promise<SeismicEvent[]> {
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query` +
    `?format=geojson&limit=${limit}&minmagnitude=${minMag}&orderby=time`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      console.warn(`[USGS] HTTP ${res.status}`)
      return []
    }
    const data = await res.json()
    return ((data.features ?? []) as any[]).map((f): SeismicEvent => ({
      id: f.id,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      depth: f.geometry.coordinates[2] ?? 0,
      magnitude: f.properties.mag ?? 0,
      place: f.properties.place ?? '',
      time: f.properties.time ?? 0,
    }))
  } catch (err) {
    console.error('[USGS] Fetch failed:', err)
    return []
  }
}
