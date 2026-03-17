// n2yo.com REST API + satellite.js real-time propagation
// @ts-ignore (no @types/satellite.js package available)
import * as satellite from 'satellite.js'

export interface SatelliteState {
  id: string          // NORAD catalog number as string
  name: string
  latitude: number
  longitude: number
  altitudeKm: number
  catalog: string     // 'stations' | 'starlink' | 'notable' | etc.
  orbitSegments: number[][] // array of segments, each flat [lon, lat, altM, ...]
}

// Stored TLE record for real-time propagation
interface TLERecord {
  id: string
  name: string
  satrec: any
  catalog: string
}

const N2YO_KEY = import.meta.env.VITE_N2YO_API_KEY ?? ''

// Notable NORAD IDs: space stations, telescopes, weather, earth observation
const NOTABLE_IDS = [
  25544,  // ISS (ZARYA)
  49044,  // ISS (NAUKA)
  48274,  // CSS (TIANHE)
  20580,  // Hubble Space Telescope
  43013,  // NOAA 20 (JPSS-1)
  33591,  // NOAA 19
  28654,  // NOAA 18
  25338,  // NOAA 15
  49260,  // LANDSAT 9
  39084,  // LANDSAT 8
  27424,  // ENVISAT
  36411,  // SDO (Solar Dynamics Observatory)
  40069,  // GPM (Global Precipitation)
  25994,  // TERRA
  27386,  // AQUA
]

// n2yo category IDs for /above/ endpoint
const CATEGORIES = [
  { id: 2,  label: 'stations' },   // Space stations
  { id: 52, label: 'starlink' },   // Starlink
]

// Observer points spread across the globe for broad coverage
const OBSERVERS = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 120 },
]

// ── TLE Store ─────────────────────────────────────────────────────────────────
// Stored globally so we can re-propagate positions without re-fetching
const tleStore = new Map<string, TLERecord>()

// Compute one full orbital arc centered on `now` (half backward, half forward)
// This ensures the satellite's current position is always in the MIDDLE of its path
function computeOrbitSegments(satrec: any, altKm: number, now: Date): number[][] {
  const R = 6371 + altKm
  const T = 2 * Math.PI * Math.sqrt((R * R * R) / 398600.4418)
  const stepSec = 120
  const halfSteps = Math.ceil(T / stepSec / 2)

  // Collect all points from -T/2 to +T/2 centered on now
  const points: { lon: number; lat: number; alt: number }[] = []
  for (let i = -halfSteps; i <= halfSteps; i++) {
    const t = new Date(now.getTime() + i * stepSec * 1000)
    try {
      const pv = satellite.propagate(satrec, t)
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue
      const gmst = satellite.gstime(t)
      const geo = satellite.eciToGeodetic(pv.position as any, gmst)
      const lat = satellite.degreesLat(geo.latitude)
      const lon = satellite.degreesLong(geo.longitude)
      const alt = geo.height * 1000
      if (isNaN(lat) || isNaN(lon)) continue
      points.push({ lon, lat, alt })
    } catch {
      // skip bad propagation points
    }
  }

  // Split into segments at antimeridian crossings
  const segments: number[][] = []
  let current: number[] = []
  let prevLon = NaN
  for (const p of points) {
    if (!isNaN(prevLon) && Math.abs(p.lon - prevLon) > 180) {
      if (current.length >= 6) segments.push(current)
      current = []
    }
    current.push(p.lon, p.lat, p.alt)
    prevLon = p.lon
  }
  if (current.length >= 6) segments.push(current)
  return segments
}

// Propagate a single satrec to a SatelliteState
function propagateRecord(rec: TLERecord, now: Date, withOrbitPath: boolean): SatelliteState | null {
  try {
    const pv = satellite.propagate(rec.satrec, now)
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null

    const gmst = satellite.gstime(now)
    const geo = satellite.eciToGeodetic(pv.position as any, gmst)
    const lat = satellite.degreesLat(geo.latitude)
    const lon = satellite.degreesLong(geo.longitude)
    const altKm = geo.height

    if (isNaN(lat) || isNaN(lon) || isNaN(altKm)) return null

    const orbitSegments = withOrbitPath ? computeOrbitSegments(rec.satrec, altKm, now) : []

    return {
      id: rec.id,
      name: rec.name,
      latitude: lat,
      longitude: lon,
      altitudeKm: altKm,
      catalog: rec.catalog,
      orbitSegments,
    }
  } catch {
    return null
  }
}

// Cache orbit segments — refreshed every 2 minutes to keep paths aligned with positions
const orbitSegmentCache = new Map<string, number[][]>()
let lastOrbitComputeTime = 0
let lastOrbitComputeSize = 0
const ORBIT_REFRESH_MS = 120_000  // 2 minutes

/**
 * Re-propagate all stored TLE records to current time.
 * Called on a fast timer (every 3s) to keep satellite positions accurate.
 * Orbit segments are recomputed every 2 minutes to stay aligned.
 */
export function propagateAll(): SatelliteState[] {
  if (tleStore.size === 0) return []
  const now = new Date()
  const elapsed = now.getTime() - lastOrbitComputeTime
  const needOrbitRecompute = tleStore.size !== lastOrbitComputeSize || elapsed > ORBIT_REFRESH_MS

  if (needOrbitRecompute) {
    // Recompute all orbit segments from current TLE data
    orbitSegmentCache.clear()
    for (const rec of tleStore.values()) {
      try {
        // Get current altitude for orbital period calculation
        const pv = satellite.propagate(rec.satrec, now)
        if (!pv || !pv.position || typeof pv.position === 'boolean') {
          orbitSegmentCache.set(rec.id, [])
          continue
        }
        const gmst = satellite.gstime(now)
        const geo = satellite.eciToGeodetic(pv.position as any, gmst)
        const altKm = geo.height
        if (isNaN(altKm) || altKm < 0) {
          orbitSegmentCache.set(rec.id, [])
          continue
        }
        const segs = computeOrbitSegments(rec.satrec, altKm, now)
        orbitSegmentCache.set(rec.id, segs)
      } catch {
        orbitSegmentCache.set(rec.id, [])
      }
    }
    lastOrbitComputeSize = tleStore.size
    lastOrbitComputeTime = now.getTime()
  }

  const states: SatelliteState[] = []
  for (const rec of tleStore.values()) {
    const s = propagateRecord(rec, now, false) // position only — fast
    if (s) {
      s.orbitSegments = orbitSegmentCache.get(rec.id) ?? []
      states.push(s)
    }
  }
  return states
}

/**
 * Re-propagate all stored TLE records to a specific Date (for playback mode).
 * Orbit segments are always recomputed since the date differs from live.
 */
export function propagateAllAtTime(date: Date): SatelliteState[] {
  if (tleStore.size === 0) return []

  const states: SatelliteState[] = []
  for (const rec of tleStore.values()) {
    const s = propagateRecord(rec, date, false)
    if (s) {
      s.orbitSegments = computeOrbitSegments(rec.satrec, s.altitudeKm, date)
      states.push(s)
    }
  }
  return states
}

/**
 * Search loaded satellites by NORAD ID or name substring.
 */
export function searchSatellites(query: string): Array<{ id: string; name: string }> {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const results: Array<{ id: string; name: string }> = []
  for (const rec of tleStore.values()) {
    if (rec.id === q || rec.name.toUpperCase().includes(q) || rec.id.includes(q)) {
      results.push({ id: rec.id, name: rec.name })
    }
    if (results.length >= 20) break
  }
  return results
}

/**
 * Fetch and add a satellite by NORAD ID (if not already loaded).
 * Returns true if successfully added.
 */
export async function fetchSatelliteById(noradId: number): Promise<boolean> {
  if (tleStore.has(String(noradId))) return true
  return fetchAndStoreTLE(noradId, 'lookup')
}

// Fetch TLE for a single satellite from n2yo and store it
async function fetchAndStoreTLE(noradId: number, catalog: string): Promise<boolean> {
  try {
    const res = await fetch(`/n2yo/rest/v1/satellite/tle/${noradId}?apiKey=${N2YO_KEY}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return false
    const d = await res.json()
    if (!d.tle) return false

    const tleLines = d.tle.split('\r\n').filter(Boolean)
    if (tleLines.length < 2) return false

    const satrec = satellite.twoline2satrec(tleLines[0], tleLines[1])
    const id = String(noradId)
    tleStore.set(id, {
      id,
      name: (d.info?.satname ?? `SAT-${noradId}`).trim(),
      satrec,
      catalog,
    })
    return true
  } catch {
    return false
  }
}

// Use /above/ endpoint to discover satellite IDs, then fetch their TLEs
async function fetchAboveAndStoreTLEs(
  lat: number,
  lng: number,
  categoryId: number,
  catalog: string,
): Promise<number> {
  try {
    const res = await fetch(
      `/n2yo/rest/v1/satellite/above/${lat}/${lng}/0/90/${categoryId}?apiKey=${N2YO_KEY}`,
      { signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return 0
    const data = await res.json()
    const sats = data.above ?? []

    // Fetch TLEs for up to 30 discovered satellites (rate-conscious)
    let count = 0
    const batch = sats.slice(0, 30)
    const results = await Promise.all(
      batch
        .filter((s: any) => !tleStore.has(String(s.satid)))
        .map((s: any) => fetchAndStoreTLE(s.satid, catalog))
    )
    count = results.filter(Boolean).length
    return count
  } catch (err) {
    console.warn(`[Satellites] /above/ failed for cat ${categoryId}:`, err)
    return 0
  }
}

// CelesTrak fallback — parse bulk TLE and store records
function parseTLEs(text: string): Array<{ name: string; line1: string; line2: string }> {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  const result = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (line1.startsWith('1 ') && line2.startsWith('2 ')) {
      result.push({ name, line1, line2 })
    }
  }
  return result
}

async function fetchCelesTrakFallback(): Promise<void> {
  try {
    const res = await fetch('/celestrak/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE', {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return
    const text = await res.text()
    const tles = parseTLEs(text)
    for (const { name, line1, line2 } of tles) {
      try {
        const satrec = satellite.twoline2satrec(line1, line2)
        const id = satrec.satnum
        if (!tleStore.has(id)) {
          tleStore.set(id, { id, name: name.trim(), satrec, catalog: 'stations' })
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

/**
 * Fetch TLE data from n2yo.com (or CelesTrak fallback) and store for propagation.
 * Returns initial positions. Call propagateAll() on a fast timer for updates.
 */
export async function fetchSatellites(_catalogs = ['stations']): Promise<SatelliteState[]> {
  if (!N2YO_KEY) {
    console.warn('[Satellites] No VITE_N2YO_API_KEY, falling back to CelesTrak')
    await fetchCelesTrakFallback()
    const states = propagateAll()
    console.info(`[Satellites] Loaded ${states.length} satellites from CelesTrak`)
    return states
  }

  // 1. Fetch notable satellites by TLE (parallel)
  await Promise.all(
    NOTABLE_IDS.map(id => fetchAndStoreTLE(id, 'notable'))
  )

  // 2. Discover satellites via /above/ and fetch their TLEs
  for (const obs of OBSERVERS) {
    for (const cat of CATEGORIES) {
      await fetchAboveAndStoreTLEs(obs.lat, obs.lng, cat.id, cat.label)
    }
  }

  // 3. CelesTrak fallback if very few results
  if (tleStore.size < 5) {
    console.warn('[Satellites] n2yo returned few results, trying CelesTrak fallback')
    await fetchCelesTrakFallback()
  }

  // Initial propagation
  const states = propagateAll()
  console.info(`[Satellites] Loaded ${states.length} satellites (${tleStore.size} TLEs stored)`)
  return states
}
