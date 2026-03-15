// Aviation data: airplanes.live (primary) → OpenSky OAuth2 (fallback)

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

// ── Shared ADSBx-v2-format parser (used by airplanes.live) ─────────────────
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

// ── airplanes.live — free, CORS-enabled, global coverage ────────────────────
// API: https://api.airplanes.live/v2/point/{lat}/{lon}/{radius_nm}
// Returns ADSBx-v2 format, ~7000 aircraft globally with radius=25000
async function fetchAirplanesLive(): Promise<FlightState[]> {
  try {
    const res = await fetch('https://api.airplanes.live/v2/point/20/0/25000', {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[airplanes.live] HTTP ${res.status}`)
      return []
    }
    const data = await res.json()
    const now = (data.now ?? Date.now()) / 1000
    const acArray = (data.ac ?? []) as any[]
    console.info(`[airplanes.live] ${acArray.length} aircraft received`)
    return parseADSBv2(acArray, now)
  } catch (err) {
    console.error('[airplanes.live] Fetch failed:', err)
    return []
  }
}

// ── OpenSky OAuth2 token cache ─────────────────────────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null

async function getOpenSkyToken(): Promise<string | null> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token
  }

  const clientId     = import.meta.env.VITE_OPENSKY_CLIENT_ID
  const clientSecret = import.meta.env.VITE_OPENSKY_CLIENT_SECRET
  if (!clientId || !clientSecret || clientId.includes('your_')) return null

  const tokenUrl = import.meta.env.DEV
    ? '/opensky-token'
    : 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
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
  const url = import.meta.env.DEV
    ? `/opensky/api/states/all?${qs}`
    : `https://opensky-network.org/api/states/all?${qs}`

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

// ── Primary fetch: airplanes.live first, OpenSky fallback ───────────────────
export async function fetchFlights(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<FlightState[]> {
  // airplanes.live is free, CORS-enabled, and covers global aircraft
  const results = await fetchAirplanesLive()
  if (results.length > 0) return results

  // Fall back to OpenSky with OAuth2
  console.warn('[Aviation] airplanes.live returned empty, trying OpenSky...')
  return fetchOpenSkyFlights(bbox)
}
