// Space-Track.org GP API (primary) + CelesTrak fallback + satellite.js propagation
// @ts-ignore (no @types/satellite.js package available)
import * as satellite from 'satellite.js'

export interface SatelliteState {
  id: string          // NORAD catalog number as string
  name: string
  latitude: number
  longitude: number
  altitudeKm: number
  catalog: string     // category label
  orbitSegments: number[][] // array of segments, each flat [lon, lat, altM, ...]
}

// Stored TLE record for real-time propagation
interface TLERecord {
  id: string
  name: string
  satrec: any
  catalog: string
}

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

// Max satellites to store — keeps rendering performant
const MAX_SATELLITES = 2000

// CelesTrak groups — curated for meaningful operational satellites.
// Excludes mega-constellations (Starlink ~6K, OneWeb ~600, Planet ~200)
// which overwhelm the renderer. Users can look up individual sats by NORAD ID.
// NOTE: Space-Track's gp class has no GROUP predicate (that's CelesTrak syntax),
// so group fetches go to CelesTrak; Space-Track is used for by-ID lookups only.
const CELESTRAK_GROUPS: Array<{ group: string; catalog: string }> = [
  { group: 'stations',          catalog: 'stations' },
  { group: 'visual',            catalog: 'visual' },
  { group: 'weather',           catalog: 'weather' },
  { group: 'noaa',              catalog: 'weather' },
  { group: 'goes',              catalog: 'weather' },
  { group: 'resource',          catalog: 'earth-obs' },
  { group: 'sarsat',            catalog: 'sarsat' },
  { group: 'tdrss',             catalog: 'relay' },
  { group: 'argos',             catalog: 'earth-obs' },
  { group: 'intelsat',          catalog: 'comms' },
  { group: 'ses',               catalog: 'comms' },
  { group: 'iridium-NEXT',      catalog: 'comms' },
  { group: 'globalstar',        catalog: 'comms' },
  { group: 'amateur',           catalog: 'amateur' },
  { group: 'science',           catalog: 'science' },
  { group: 'military',          catalog: 'military' },
  { group: 'engineering',       catalog: 'engineering' },
  { group: 'gnss',              catalog: 'navigation' },
  { group: 'gps-ops',           catalog: 'navigation' },
  { group: 'glo-ops',           catalog: 'navigation' },
  { group: 'galileo',           catalog: 'navigation' },
  { group: 'beidou',            catalog: 'navigation' },
  { group: 'geo',               catalog: 'geo' },
]

// IDs that should always get orbit paths computed
const ORBIT_PATH_IDS = new Set(NOTABLE_IDS.map(String))

// Satellites the user is actively tracking — get orbit paths
const trackedSatId = new Set<string>()

/** Mark a satellite for orbit path rendering (called when user tracks a sat) */
export function trackSatelliteOrbit(id: string) { trackedSatId.add(id) }

/** Remove orbit tracking for a satellite */
export function untrackSatelliteOrbit(id: string) { trackedSatId.delete(id) }

// ── TLE Store ─────────────────────────────────────────────────────────────────
const tleStore = new Map<string, TLERecord>()

// Compute one full orbital arc centered on `now`
function computeOrbitSegments(satrec: any, altKm: number, now: Date): number[][] {
  const R = 6371 + altKm
  const T = 2 * Math.PI * Math.sqrt((R * R * R) / 398600.4418)
  const stepSec = 120
  const halfSteps = Math.ceil(T / stepSec / 2)

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
    } catch { /* skip */ }
  }

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

// Orbit segment cache
const orbitSegmentCache = new Map<string, number[][]>()
let lastOrbitComputeTime = 0
let lastOrbitComputeSize = 0
let lastOrbitAllMode = false
const ORBIT_REFRESH_MS = 120_000

export function propagateAll(computeAllOrbits = false): SatelliteState[] {
  if (tleStore.size === 0) return []
  const now = new Date()
  const elapsed = now.getTime() - lastOrbitComputeTime
  const sizeChanged = tleStore.size !== lastOrbitComputeSize
  const modeChanged = computeAllOrbits !== lastOrbitAllMode
  const needOrbitRecompute = sizeChanged || modeChanged || elapsed > ORBIT_REFRESH_MS

  if (needOrbitRecompute) {
    orbitSegmentCache.clear()
    for (const rec of tleStore.values()) {
      // When computeAllOrbits is true, compute for every sat; otherwise only notable/tracked
      if (!computeAllOrbits && !ORBIT_PATH_IDS.has(rec.id) && !trackedSatId.has(rec.id)) continue
      try {
        const pv = satellite.propagate(rec.satrec, now)
        if (!pv || !pv.position || typeof pv.position === 'boolean') continue
        const gmst = satellite.gstime(now)
        const geo = satellite.eciToGeodetic(pv.position as any, gmst)
        const altKm = geo.height
        if (isNaN(altKm) || altKm < 0) continue
        const segs = computeOrbitSegments(rec.satrec, altKm, now)
        orbitSegmentCache.set(rec.id, segs)
      } catch { /* skip */ }
    }
    lastOrbitComputeSize = tleStore.size
    lastOrbitComputeTime = now.getTime()
    lastOrbitAllMode = computeAllOrbits
  }

  const states: SatelliteState[] = []
  for (const rec of tleStore.values()) {
    const s = propagateRecord(rec, now, false)
    if (s) {
      s.orbitSegments = orbitSegmentCache.get(rec.id) ?? []
      states.push(s)
    }
  }
  return states
}

export function propagateAllAtTime(date: Date): SatelliteState[] {
  if (tleStore.size === 0) return []
  const states: SatelliteState[] = []
  for (const rec of tleStore.values()) {
    const s = propagateRecord(rec, date, false)
    if (s) {
      // Only compute orbit paths for notable/tracked sats
      if (ORBIT_PATH_IDS.has(rec.id) || trackedSatId.has(rec.id)) {
        s.orbitSegments = computeOrbitSegments(rec.satrec, s.altitudeKm, date)
      }
      states.push(s)
    }
  }
  return states
}

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

export async function fetchSatelliteById(noradId: number): Promise<boolean> {
  if (tleStore.has(String(noradId))) return true
  const ok = await fetchSpaceTrackByIds([noradId], 'lookup')
  if (ok > 0) return true
  return fetchCelesTrakById(noradId, 'lookup')
}

// ── Space-Track.org GP API ───────────────────────────────────────────────────

interface SpaceTrackGP {
  NORAD_CAT_ID: string
  OBJECT_NAME: string
  TLE_LINE1: string
  TLE_LINE2: string
}

async function fetchSpaceTrackByIds(ids: number[], catalog: string): Promise<number> {
  if (ids.length === 0) return 0
  const idList = ids.join(',')
  try {
    const res = await fetch(
      `/spacetrack/basicspacedata/query/class/gp/NORAD_CAT_ID/${idList}/orderby/NORAD_CAT_ID/format/json`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) {
      console.warn(`[Satellites] Space-Track GP query failed: ${res.status}`)
      return 0
    }
    const data: SpaceTrackGP[] = await res.json()
    return storeGPRecords(data, catalog)
  } catch (err: any) {
    console.warn('[Satellites] Space-Track fetch error:', err.message)
    return 0
  }
}

function storeGPRecords(records: SpaceTrackGP[], catalog: string): number {
  let count = 0
  for (const gp of records) {
    if (tleStore.size >= MAX_SATELLITES) break
    if (!gp.TLE_LINE1 || !gp.TLE_LINE2) continue
    try {
      const satrec = satellite.twoline2satrec(gp.TLE_LINE1, gp.TLE_LINE2)
      const id = gp.NORAD_CAT_ID
      if (!tleStore.has(id)) {
        tleStore.set(id, {
          id,
          name: (gp.OBJECT_NAME ?? `SAT-${id}`).trim(),
          satrec,
          catalog,
        })
        count++
      }
    } catch { /* skip invalid TLE */ }
  }
  return count
}

// ── CelesTrak Fallback ──────────────────────────────────────────────────────

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

async function fetchCelesTrakGroup(group: string, catalog: string): Promise<number> {
  if (tleStore.size >= MAX_SATELLITES) return 0
  try {
    const res = await fetch(`/celestrak/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return 0
    const text = await res.text()
    const tles = parseTLEs(text)
    let count = 0
    for (const { name, line1, line2 } of tles) {
      if (tleStore.size >= MAX_SATELLITES) break
      try {
        const satrec = satellite.twoline2satrec(line1, line2)
        const id = satrec.satnum
        if (!tleStore.has(id)) {
          tleStore.set(id, { id, name: name.trim(), satrec, catalog })
          count++
        }
      } catch { /* skip */ }
    }
    return count
  } catch {
    return 0
  }
}

async function fetchCelesTrakById(noradId: number, catalog: string): Promise<boolean> {
  try {
    const res = await fetch(`/celestrak/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return false
    const text = await res.text()
    const tles = parseTLEs(text)
    if (tles.length === 0) return false
    const { name, line1, line2 } = tles[0]
    const satrec = satellite.twoline2satrec(line1, line2)
    const id = String(noradId)
    tleStore.set(id, { id, name: name.trim(), satrec, catalog })
    return true
  } catch {
    return false
  }
}

// ── Batch helpers ───────────────────────────────────────────────────────────

/**
 * Fetch multiple groups in parallel with concurrency limit.
 * Returns total count of new TLEs stored.
 */
async function fetchGroupsBatched(
  groups: Array<{ group: string; catalog: string }>,
  fetcher: (group: string, catalog: string) => Promise<number>,
  concurrency: number,
): Promise<number> {
  let total = 0
  for (let i = 0; i < groups.length; i += concurrency) {
    const batch = groups.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(({ group, catalog }) => fetcher(group, catalog))
    )
    for (const r of results) {
      if (r.status === 'fulfilled') total += r.value
    }
  }
  return total
}

// ── Main Fetch Entry Point ──────────────────────────────────────────────────

/**
 * Fetch TLE data from Space-Track.org (notable sats) + CelesTrak (groups)
 * and store for satellite.js propagation.
 * Returns initial positions. Call propagateAll() on a fast timer for updates.
 */
export async function fetchSatellites(): Promise<SatelliteState[]> {
  console.info('[Satellites] Starting TLE fetch...')

  // 1. Fetch notable satellites by ID from Space-Track (fast, single query;
  //    falls through to CelesTrak below if unavailable)
  const notableCount = await fetchSpaceTrackByIds(NOTABLE_IDS, 'notable')
  if (notableCount > 0) {
    console.info(`[Satellites] Space-Track: ${notableCount} notable sats loaded`)
  } else {
    console.warn('[Satellites] Space-Track unavailable or no credentials — using CelesTrak only')
  }

  // 2. Fetch all groups from CelesTrak (free, no auth) in parallel batches of 8
  const ctCount = await fetchGroupsBatched(CELESTRAK_GROUPS, fetchCelesTrakGroup, 8)
  console.info(`[Satellites] CelesTrak: ${ctCount} new TLEs (${tleStore.size} total)`)

  // 3. Make sure all notable IDs are present (belt-and-suspenders)
  const missingNotable = NOTABLE_IDS.filter(id => !tleStore.has(String(id)))
  if (missingNotable.length > 0) {
    await Promise.allSettled(
      missingNotable.map(id => fetchCelesTrakById(id, 'notable'))
    )
  }

  // Initial propagation
  const states = propagateAll()
  console.info(`[Satellites] Ready: ${states.length} positions from ${tleStore.size} TLEs`)
  return states
}
