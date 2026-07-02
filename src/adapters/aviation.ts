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

// ── ADSBx-v2-format point providers ─────────────────────────────────────────
// Three independent free feeds, all speaking the same v2 dialect. Each has its
// own rate limit (adsb.fi: 1 req/s per IP), so requests are serialized
// per-provider and providers are rotated for multi-point sweeps.
// adsb.lol has no CORS headers → proxied; airplanes.live sends ACAO:* → direct.
interface AdsbProvider {
  name: string
  pointUrl: (lat: number, lon: number, distNm: number) => string
  milUrl: string | null
  minGapMs: number
  nextAt: number
}

const ADSB_PROVIDERS: AdsbProvider[] = [
  {
    name: 'adsb.lol',
    pointUrl: (lat, lon, d) => `/adsblol/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${d}`,
    milUrl: '/adsblol/v2/mil',
    minGapMs: 1_100,
    nextAt: 0,
  },
  {
    name: 'airplanes.live',
    pointUrl: (lat, lon, d) => `https://api.airplanes.live/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${d}`,
    milUrl: 'https://api.airplanes.live/v2/mil',
    minGapMs: 1_100,
    nextAt: 0,
  },
  {
    name: 'adsb.fi',
    pointUrl: (lat, lon, d) => `/adsbfi/api/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${d}`,
    milUrl: '/adsbfi/api/v2/mil',
    minGapMs: 1_100,
    nextAt: 0,
  },
]

// Serialize requests per provider so we never violate its rate limit even
// when the civil poll and mil feed fire in the same tick.
async function providerFetch(p: AdsbProvider, url: string): Promise<FlightState[] | null> {
  const wait = p.nextAt - Date.now()
  p.nextAt = Math.max(p.nextAt, Date.now()) + p.minGapMs
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      console.warn(`[${p.name}] HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    const acArray = (data.aircraft ?? data.ac ?? []) as any[]
    return parseADSBv2(acArray, epochSeconds(data.now))
  } catch (err) {
    console.warn(`[${p.name}] fetch failed:`, err)
    return null
  }
}

// Point query with provider rotation — tries each provider once.
let _pointRotation = 0
async function fetchAdsbPoint(lat: number, lon: number, distNm = 250): Promise<FlightState[]> {
  for (let i = 0; i < ADSB_PROVIDERS.length; i++) {
    const p = ADSB_PROVIDERS[(_pointRotation + i) % ADSB_PROVIDERS.length]
    const result = await providerFetch(p, p.pointUrl(lat, lon, distNm))
    if (result && result.length) {
      _pointRotation = (_pointRotation + i + 1) % ADSB_PROVIDERS.length
      console.info(`[${p.name}] ${result.length} aircraft received`)
      return result
    }
  }
  return []
}

// ── Global fallback sweep — point queries over the world's traffic hubs ─────
// A 250 nm point query only covers ~460 km, so a "global" view is stitched
// from hub queries spread round-robin across providers (respecting per-
// provider serialization). Coarse but keeps the layer alive when OpenSky
// is down or rate-limited.
const WORLD_HUBS: [number, number][] = [
  [40.7, -74.0],   // US East (NYC)
  [41.9, -87.6],   // US Central (Chicago)
  [34.0, -118.2],  // US West (LA)
  [29.8, -95.4],   // US South (Houston)
  [51.5, -0.1],    // UK/W. Europe (London)
  [48.9, 8.2],     // Central Europe (Frankfurt/Stuttgart)
  [41.0, 28.9],    // E. Med (Istanbul)
  [25.3, 55.4],    // Gulf (Dubai)
  [28.6, 77.2],    // South Asia (Delhi)
  [31.2, 121.5],   // China (Shanghai)
  [35.7, 139.7],   // Japan (Tokyo)
  [1.35, 103.99],  // SE Asia (Singapore)
  [-23.5, -46.6],  // South America (São Paulo)
  [-33.9, 151.2],  // Australia (Sydney)
]

let _sweepCache: { data: FlightState[]; at: number } | null = null

async function fetchGlobalSweep(): Promise<FlightState[]> {
  if (_sweepCache && Date.now() - _sweepCache.at < 25_000) return _sweepCache.data

  // Distribute hubs across providers; each provider works its share serially
  const shares: [AdsbProvider, [number, number][]][] = ADSB_PROVIDERS.map((p, i) =>
    [p, WORLD_HUBS.filter((_, h) => h % ADSB_PROVIDERS.length === i)])

  const results = await Promise.all(shares.map(async ([p, hubs]) => {
    const out: FlightState[] = []
    for (const [lat, lon] of hubs) {
      const r = await providerFetch(p, p.pointUrl(lat, lon, 250))
      if (r) out.push(...r)
    }
    return out
  }))

  const merged = new Map<string, FlightState>()
  for (const batch of results) for (const f of batch) merged.set(f.icao24, f)
  const data = [...merged.values()]
  console.info(`[Aviation] Global sweep: ${data.length} aircraft from ${WORLD_HUBS.length} hubs`)
  if (data.length) _sweepCache = { data, at: Date.now() }
  return data
}

// ── Military feed — adsb.lol primary, airplanes.live/adsb.fi fallback ───────
let _milInFlight: Promise<FlightState[]> | null = null
let _milCache: { data: FlightState[]; at: number } | null = null

export async function fetchMilitaryFlights(): Promise<FlightState[]> {
  if (_milCache && Date.now() - _milCache.at < 15_000) return _milCache.data
  if (_milInFlight) return _milInFlight

  _milInFlight = (async () => {
    try {
      for (const p of ADSB_PROVIDERS) {
        if (!p.milUrl) continue
        const parsed = await providerFetch(p, p.milUrl)
        if (parsed && parsed.length) {
          const flagged = parsed.map(f => ({ ...f, military: true }))
          _milCache = { data: flagged, at: Date.now() }
          console.info(`[${p.name} mil] ${flagged.length} military aircraft`)
          return flagged
        }
      }
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

// Last observed OpenSky failure mode — lets the UI show an accurate message
// instead of a generic "rate limited" for what is actually a credentials problem.
export type OpenSkyStatus = 'ok' | 'invalid-credentials' | 'rate-limited' | 'error' | 'unknown'
let _openSkyStatus: OpenSkyStatus = 'unknown'
export function getOpenSkyStatus(): OpenSkyStatus { return _openSkyStatus }

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
      if (res.status === 400 || res.status === 401) {
        _openSkyStatus = 'invalid-credentials'
        console.warn('[OpenSky OAuth] Credentials rejected — regenerate an API client at opensky-network.org (Account → API Client)')
      } else {
        console.warn(`[OpenSky OAuth] Token fetch failed: HTTP ${res.status}`)
      }
      return null
    }
    _openSkyStatus = 'ok'
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
    if (response.status === 429) {
      if (_openSkyStatus !== 'invalid-credentials') _openSkyStatus = 'rate-limited'
      console.warn('[OpenSky] 429 rate-limited')
      return []
    }
    if (!response.ok) {
      console.warn(`[OpenSky] HTTP ${response.status}`)
      return []
    }
    _openSkyStatus = 'ok'

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

  // Global view: stitch a world snapshot from hub point-queries across the
  // free ADSBx-v2 providers (adsb.lol / airplanes.live / adsb.fi).
  if (bbox.maxLat - bbox.minLat > 90) {
    console.warn('[Aviation] OpenSky returned empty — running global hub sweep...')
    return fetchGlobalSweep()
  }
  console.warn('[Aviation] OpenSky returned empty — trying point providers...')
  const cLat = (bbox.minLat + bbox.maxLat) / 2
  const cLon = (bbox.minLon + bbox.maxLon) / 2
  return fetchAdsbPoint(cLat, cLon)
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
