// Aviation data: OpenSky (primary, global) → adsb.fi (fallback, regional)
// Military layer supplement: adsb.fi /v2/mil (global military aircraft)

export interface FlightState {
  icao24: string
  callsign: string
  origin_country: string
  time_position: number | null
  last_contact: number
  longitude: number | null
  latitude: number | null
  baro_altitude: number | null
  on_ground: boolean
  velocity: number | null
  true_track: number | null
  vertical_rate: number | null
  sensors: number[] | null
  geo_altitude: number | null
  squawk: string | null
  spi: boolean
  position_source: number
  military: boolean
}

// ── Military classification helper ─────────────────────────────────────────
const MIL_PREFIXES = ['RCH', 'EVAC', 'SAM', 'DOOM', 'TOPCAT', 'EPIC', 'JAKE', 'IRON', 'BISON',
  'BDOG', 'HAVOC', 'BOXER', 'DUKE', 'KING', 'NAVY', 'SPAR', 'REACH', 'FORTE', 'RRR']

export function isMilitaryFlight(f: FlightState): boolean {
  if (f.military) return true
  const sq = parseInt(f.squawk ?? '', 10)
  if (!isNaN(sq) && sq >= 5000 && sq <= 5777) return true
  const cs = (f.callsign ?? '').toUpperCase()
  return MIL_PREFIXES.some(p => cs.startsWith(p))
}

// Normalize an epoch that may be seconds (adsb.fi) or milliseconds
// (airplanes.live legacy / Date.now fallback) to seconds. Getting this
// wrong makes every aircraft look hours stale and the staleness filter
// silently drops the entire feed.
function epochSeconds(raw: unknown): number {
  const n = typeof raw === 'number' && isFinite(raw) ? raw : Date.now()
  return n > 1e12 ? n / 1000 : n
}

// ── Shared ADSBx-v2-format parser (used by adsb.fi) ────────────────────────
function parseADSBv2(acArray: any[], now: number): FlightState[] {
  return acArray
    .map((a): FlightState => ({
      icao24: a.hex ?? '',
      callsign: (a.flight ?? a.r ?? '').trim(),
      origin_country: '',
      time_position: now,
      last_contact: now,
      longitude: a.lon ?? null,
      latitude: a.lat ?? null,
      // Altitudes in feet → metres
      baro_altitude: typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null,
      on_ground: a.alt_baro === 'ground',
      velocity: typeof a.gs === 'number' ? Math.round(a.gs * 0.514444) : null,
      true_track: a.track ?? null,
      vertical_rate: typeof a.baro_rate === 'number' ? a.baro_rate * 0.00508 : null,
      sensors: null,
      geo_altitude: typeof a.alt_geom === 'number' ? Math.round(a.alt_geom * 0.3048) : null,
      squawk: a.squawk ?? null,
      spi: a.spi === 1,
      position_source: 0,
      military: !!(a.dbFlags & 1),
    }))
    .filter(f => f.icao24 && f.latitude !== null && f.longitude !== null)
}

// ── adsb.fi opendata — free, proxied via /adsbfi to avoid CORS ──────────────
// API: /api/v2/lat/{lat}/lon/{lon}/dist/{radius_nm}  (max radius 250 nm)
// Response: { now, aircraft: [...], resultCount } in ADSBx-v2 format
async function fetchAdsbFiPoint(lat: number, lon: number, distNm = 250): Promise<FlightState[]> {
  try {
    const res = await fetch(`/adsbfi/api/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${distNm}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[adsb.fi] HTTP ${res.status}`)
      return []
    }
    const data = await res.json()
    const acArray = (data.aircraft ?? data.ac ?? []) as any[]
    console.info(`[adsb.fi] ${acArray.length} aircraft received`)
    return parseADSBv2(acArray, epochSeconds(data.now))
  } catch (err) {
    console.error('[adsb.fi] Fetch failed:', err)
    return []
  }
}

// ── adsb.fi military feed — all aircraft flagged military, global ───────────
// adsb.fi rate-limits aggressively (1 req/s); dedupe concurrent calls and
// cache briefly so StrictMode double-effects don't trigger 429s.
let _milInFlight: Promise<FlightState[]> | null = null
let _milCache: { data: FlightState[]; at: number } | null = null

export async function fetchMilitaryFlights(): Promise<FlightState[]> {
  if (_milCache && Date.now() - _milCache.at < 15_000) return _milCache.data
  if (_milInFlight) return _milInFlight

  _milInFlight = (async () => {
    try {
      const res = await fetch('/adsbfi/api/v2/mil', { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) {
        console.warn(`[adsb.fi mil] HTTP ${res.status}`)
        return _milCache?.data ?? []
      }
      const data = await res.json()
      const acArray = (data.aircraft ?? data.ac ?? []) as any[]
      const parsed = parseADSBv2(acArray, epochSeconds(data.now)).map(f => ({ ...f, military: true }))
      _milCache = { data: parsed, at: Date.now() }
      return parsed
    } catch (err) {
      console.error('[adsb.fi mil] Fetch failed:', err)
      return _milCache?.data ?? []
    } finally {
      _milInFlight = null
    }
  })()
  return _milInFlight
}

// ── OpenSky OAuth2 token cache ─────────────────────────────────────────────────
// Credentials are handled SERVER-SIDE (Vite proxy in dev, Vercel edge in prod).
// The client just calls /opensky-token with no credentials.
let _tokenCache: { token: string; expiresAt: number } | null = null

async function getOpenSkyToken(): Promise<string | null> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token
  }

  const tokenUrl = '/opensky-token'

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[OpenSky OAuth] Token fetch failed: HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
    console.info('[OpenSky OAuth] Token acquired, expires in', data.expires_in, 's')
    return _tokenCache.token
  } catch (err) {
    console.error('[OpenSky OAuth] Token error:', err)
    return null
  }
}

// ── OpenSky Network (OAuth2 Bearer) — fallback ─────────────────────────────────
async function fetchOpenSkyFlights(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<FlightState[]> {
  const { minLat, maxLat, minLon, maxLon } = bbox

  const qs = `lamin=${minLat}&lomin=${minLon}&lamax=${maxLat}&lomax=${maxLon}`
  const url = `/opensky/api/states/all?${qs}`

  const token = await getOpenSkyToken()
  const fetchOptions: RequestInit = token
    ? { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    : { signal: AbortSignal.timeout(15_000) }

  try {
    const response = await fetch(url, fetchOptions)

    if (response.status === 401) {
      console.warn('[OpenSky] 401 — token expired, clearing cache.')
      _tokenCache = null
      return []
    }
    if (!response.ok) {
      console.warn(`[OpenSky] HTTP ${response.status}`)
      return []
    }

    const data = await response.json()

    if (!data?.states) {
      console.warn('[OpenSky] No states array')
      return []
    }

    console.info(`[OpenSky] Received ${data.states.length} state vectors`)

    return (data.states as any[][])
      .map((s): FlightState => ({
        icao24: s[0] ?? '',
        callsign: s[1]?.trim() ?? '',
        origin_country: s[2] ?? '',
        time_position: s[3],
        last_contact: s[4] ?? 0,
        longitude: s[5],
        latitude: s[6],
        baro_altitude: s[7],
        on_ground: s[8] ?? false,
        velocity: s[9],
        true_track: s[10],
        vertical_rate: s[11],
        sensors: s[12],
        geo_altitude: s[13],
        squawk: s[14],
        spi: s[15] ?? false,
        position_source: s[16] ?? 0,
        military: false,
      }))
      .filter(f => f.icao24 && f.latitude !== null && f.longitude !== null)

  } catch (err) {
    console.error('[OpenSky] Fetch failed:', err)
    return []
  }
}

// ── Primary fetch: OpenSky (global), adsb.fi point-query fallback ───────────
// Dedupe concurrent calls + short TTL cache — StrictMode double-effects and
// rapid layer toggles otherwise burn OpenSky's anonymous daily quota.
let _flightsInFlight: Promise<FlightState[]> | null = null
let _flightsCache: { data: FlightState[]; at: number } | null = null

export async function fetchFlights(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<FlightState[]> {
  if (_flightsCache && Date.now() - _flightsCache.at < 10_000) return _flightsCache.data
  if (_flightsInFlight) return _flightsInFlight
  _flightsInFlight = fetchFlightsUncached(bbox).then(data => {
    if (data.length) _flightsCache = { data, at: Date.now() }
    return data
  }).finally(() => { _flightsInFlight = null })
  return _flightsInFlight
}

async function fetchFlightsUncached(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<FlightState[]> {
  // OpenSky /states/all is the only free global snapshot (anonymous OK, OAuth2 raises limits)
  const results = await fetchOpenSkyFlights(bbox)
  if (results.length > 0) return results

  // Fall back to adsb.fi centered on the requested bbox (250 nm best-effort).
  // Pointless for a global bbox — the centre would be (0,0) in the Atlantic.
  if (bbox.maxLat - bbox.minLat > 90) {
    console.warn('[Aviation] OpenSky returned empty; no regional bbox for adsb.fi fallback')
    return []
  }
  console.warn('[Aviation] OpenSky returned empty, trying adsb.fi...')
  const cLat = (bbox.minLat + bbox.maxLat) / 2
  const cLon = (bbox.minLon + bbox.maxLon) / 2
  return fetchAdsbFiPoint(cLat, cLon)
}

/**
 * Fetch historical flight data at a specific Unix timestamp (seconds).
 * Uses OpenSky's `time` parameter (free tier: last ~1 hour only).
 */
export async function fetchFlightsAtTime(unixSeconds: number): Promise<FlightState[]> {
  const qs = `lamin=-90&lomin=-180&lamax=90&lomax=180&time=${Math.floor(unixSeconds)}`
  const url = `/opensky/api/states/all?${qs}`

  const token = await getOpenSkyToken()
  const fetchOptions: RequestInit = token
    ? { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    : { signal: AbortSignal.timeout(15_000) }

  try {
    const response = await fetch(url, fetchOptions)
    if (!response.ok) {
      console.warn(`[OpenSky Historical] HTTP ${response.status}`)
      return []
    }
    const data = await response.json()
    if (!data?.states) return []

    console.info(`[OpenSky Historical] ${data.states.length} states at t=${unixSeconds}`)
    return (data.states as any[][])
      .map((s): FlightState => ({
        icao24: s[0] ?? '',
        callsign: s[1]?.trim() ?? '',
        origin_country: s[2] ?? '',
        time_position: s[3],
        last_contact: s[4] ?? 0,
        longitude: s[5],
        latitude: s[6],
        baro_altitude: s[7],
        on_ground: s[8] ?? false,
        velocity: s[9],
        true_track: s[10],
        vertical_rate: s[11],
        sensors: s[12],
        geo_altitude: s[13],
        squawk: s[14],
        spi: s[15] ?? false,
        position_source: s[16] ?? 0,
        military: false,
      }))
      .filter(f => f.icao24 && f.latitude !== null && f.longitude !== null)
  } catch (err) {
    console.error('[OpenSky Historical] Fetch failed:', err)
    return []
  }
}
