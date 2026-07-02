// ── CCTV Adapter — multi-source traffic cameras ────────────────────────────
// Fetches from /api/cctv (Vite plugin aggregator) which queries TfL, Austin, NSW

export interface CameraFeed {
  id: string
  name: string
  source: CameraSource
  country: string
  countryName: string
  region: string
  latitude: number
  longitude: number
  imageUrl: string
  videoUrl?: string
  available: boolean
  viewDirection?: string
  lastUpdated: string
}

export type CameraSource = 'tfl' | 'austin' | 'tfnsw'

export interface CameraMeta {
  totalCameras: number
  onlineCameras: number
  sources: string[]
  countries: CameraCountry[]
  lastUpdated: string
}

export interface CameraCountry {
  code: string
  name: string
  flag: string
  count: number
}

export async function fetchCameras(countryFilter?: string): Promise<{ cameras: CameraFeed[]; meta: CameraMeta }> {
  const params = new URLSearchParams()
  if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)

  const url = `/api/cctv${params.toString() ? '?' + params.toString() : ''}`
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })

  if (!res.ok) throw new Error(`CCTV API ${res.status}`)

  const data = await res.json()
  return {
    cameras: data.cameras ?? [],
    meta: data.meta ?? { totalCameras: 0, onlineCameras: 0, sources: [], countries: [], lastUpdated: '' },
  }
}

export function proxyImageUrl(url: string): string {
  if (!url) return ''
  return `/api/cctv/image?url=${encodeURIComponent(url)}`
}
