// NASA FIRMS VIIRS — active fire detections, no key required (static 24h CSV)
// Source: firms.modaps.eosdis.nasa.gov

export interface WildfireHotspot {
  latitude: number
  longitude: number
  brightness: number   // K — fire radiative temperature
  frp: number          // Fire Radiative Power (MW)
  confidence: string   // 'n' | 'l' | 'h' (nominal/low/high)
  acqDate: string
}

// Proxy path (Vite dev) | direct URL (prod)
const FIRMS_URL_DEV = '/firms/data/active_fire/suomi-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv'
const FIRMS_URL_PROD = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv'

function parseCSV(text: string): WildfireHotspot[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim())
  const latIdx = header.indexOf('latitude')
  const lonIdx = header.indexOf('longitude')
  const brightIdx = header.indexOf('bright_ti4')
  const frpIdx = header.indexOf('frp')
  const confIdx = header.indexOf('confidence')
  const dateIdx = header.indexOf('acq_date')

  const result: WildfireHotspot[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const lat = parseFloat(cols[latIdx])
    const lon = parseFloat(cols[lonIdx])
    if (isNaN(lat) || isNaN(lon)) continue
    result.push({
      latitude: lat,
      longitude: lon,
      brightness: parseFloat(cols[brightIdx]) || 0,
      frp: parseFloat(cols[frpIdx]) || 0,
      confidence: (cols[confIdx] ?? 'n').trim(),
      acqDate: (cols[dateIdx] ?? '').trim(),
    })
  }
  return result
}

export async function fetchWildfires(): Promise<WildfireHotspot[]> {
  const isDev = import.meta.env.DEV
  const url = isDev ? FIRMS_URL_DEV : FIRMS_URL_PROD

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.warn(`[FIRMS] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const hotspots = parseCSV(text)
    console.info(`[FIRMS] Loaded ${hotspots.length} fire detections`)
    return hotspots
  } catch (err) {
    console.error('[FIRMS] Fetch failed:', err)
    return []
  }
}
