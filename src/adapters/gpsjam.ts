// gpsjam.org GPS Interference Heatmap
// Fetches H3 hexagon grid data showing GPS interference levels from ADS-B data
// Data: CSV with columns hex, count_good_aircraft, count_bad_aircraft

import { cellToBoundary } from 'h3-js'

export interface GpsJamCell {
  h3Index: string
  goodCount: number
  badCount: number
  interferenceRatio: number  // 0–1
  boundary: Array<[number, number]>  // [lat, lon] ring
}

// Interference level classification
export type JamLevel = 'none' | 'low' | 'medium' | 'high'

export function classifyJam(ratio: number): JamLevel {
  if (ratio < 0.02) return 'none'
  if (ratio < 0.10) return 'low'
  if (ratio < 0.30) return 'medium'
  return 'high'
}

export function jamColor(level: JamLevel): string {
  switch (level) {
    case 'none':   return 'transparent'
    case 'low':    return '#33ff33'   // green
    case 'medium': return '#ffff33'   // yellow
    case 'high':   return '#ff3333'   // red
  }
}

/**
 * Fetch GPS jamming data for a given date (defaults to yesterday).
 * Returns H3 cells with interference ratios and polygon boundaries.
 */
export async function fetchGpsJamData(date?: string): Promise<GpsJamCell[]> {
  // Default to 2 days ago (data is typically 2 days behind)
  if (!date) {
    const d = new Date()
    d.setDate(d.getDate() - 2)
    date = d.toISOString().slice(0, 10)
  }

  try {
    const res = await fetch(`/gpsjam/data/${date}-h3_4.csv`, {
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      console.warn(`[GpsJam] HTTP ${res.status} for ${date}`)
      return []
    }

    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []

    // Parse header
    const header = lines[0].split(',').map(h => h.trim())
    const hexIdx = header.indexOf('hex')
    const goodIdx = header.indexOf('count_good_aircraft')
    const badIdx = header.indexOf('count_bad_aircraft')

    if (hexIdx === -1 || goodIdx === -1 || badIdx === -1) {
      console.warn('[GpsJam] Unexpected CSV header:', header)
      return []
    }

    const cells: GpsJamCell[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',')
      if (cols.length < 3) continue

      const h3Index = cols[hexIdx].trim()
      const goodCount = parseInt(cols[goodIdx], 10)
      const badCount = parseInt(cols[badIdx], 10)
      const total = goodCount + badCount

      if (total < 3) continue  // Skip cells with too few observations

      const interferenceRatio = badCount / total

      // Only include cells with some interference (skip all-green)
      if (interferenceRatio < 0.02) continue

      try {
        const boundary = cellToBoundary(h3Index)  // [[lat, lon], ...]
        cells.push({
          h3Index,
          goodCount,
          badCount,
          interferenceRatio,
          boundary,
        })
      } catch {
        // Skip invalid H3 indices
      }
    }

    console.info(`[GpsJam] Loaded ${cells.length} interference cells for ${date}`)
    return cells
  } catch (err) {
    console.error('[GpsJam] Fetch failed:', err)
    return []
  }
}
