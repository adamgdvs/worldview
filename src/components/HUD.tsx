import { Link2 } from 'lucide-react'
import { useStore } from '../store'
// @ts-ignore
import { forward as toMGRS } from 'mgrs'

/** Convert decimal degrees to DMS string like 37°49'13.57"N */
function toDMS(dec: number, isLat: boolean): string {
  const dir = isLat ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'E' : 'W')
  const abs = Math.abs(dec)
  const d = Math.floor(abs)
  const mFull = (abs - d) * 60
  const m = Math.floor(mFull)
  const s = ((mFull - m) * 60).toFixed(2)
  return `${d}°${String(m).padStart(2, '0')}'${s}"${dir}`
}

/** Convert lat/lon to MGRS string */
function toMGRSString(lat: number, lon: number): string {
  try {
    // mgrs.forward takes [lon, lat] and precision (5 = 1m)
    return toMGRS([lon, lat], 4) // 4 = 10m precision
  } catch {
    return '—'
  }
}

/**
 * Solar elevation angle (degrees) for a given time and position.
 * NOAA simplified algorithm — accurate to ~0.1°, plenty for a HUD readout.
 */
function sunElevation(date: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180
  const dayMs = 86_400_000
  const julianDay = date.getTime() / dayMs + 2440587.5
  const d = julianDay - 2451545.0
  const g = (357.529 + 0.98560028 * d) * rad          // mean anomaly
  const q = 280.459 + 0.98564736 * d                  // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad // ecliptic long
  const e = (23.439 - 0.00000036 * d) * rad           // obliquity
  const decl = Math.asin(Math.sin(e) * Math.sin(L))
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const lst = gmst + lon / 15
  const ha = (lst * 15 * rad) - ra                    // hour angle
  const elev = Math.asin(
    Math.sin(lat * rad) * Math.sin(decl) +
    Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha)
  )
  return elev / rad
}

/** Format MGRS with spaces: "10S EG 5078 8604" */
function formatMGRS(mgrs: string): string {
  if (!mgrs || mgrs === '—') return '—'
  // MGRS format: GZD (2-3 chars) + 100km ID (2 chars) + easting/northing
  const gz = mgrs.slice(0, mgrs.length > 5 && /[A-Z]/.test(mgrs[2]) ? 3 : 2)
  const rest = mgrs.slice(gz.length)
  const sq = rest.slice(0, 2)
  const nums = rest.slice(2)
  const half = nums.length / 2
  const easting = nums.slice(0, half)
  const northing = nums.slice(half)
  return `${gz} ${sq} ${easting} ${northing}`
}

export function HUD() {
  const activeMode = useStore((s) => s.activeMode)
  const hudLayout = useStore((s) => s.hudLayout)
  const cleanUI = useStore((s) => s.cleanUI)
  const cursorGeo = useStore((s) => s.cursorGeo)
  const cameraHeight = useStore((s) => s.cameraHeight)
  const cameraBbox = useStore((s) => s.cameraBbox)

  if (cleanUI) return null

  const utcNow = new Date().toISOString().slice(11, 19) + 'Z'

  // Derived sensor readouts — real values, not set dressing.
  // GSD ≈ ground metres per screen pixel at nadir (height × pixel angular size)
  const gsdM = Math.max(0.05, cameraHeight / 1_000)
  const gsdStr = gsdM >= 1000 ? `${(gsdM / 1000).toFixed(1)}KM` : gsdM >= 1 ? `${gsdM.toFixed(1)}M` : `${(gsdM * 100).toFixed(0)}CM`
  // NIIRS from GSD via simplified GIQE: NIIRS ≈ 5 − 3.32·log10(GSD_m)
  const niirs = Math.max(0, Math.min(9, 5 - 3.32 * Math.log10(gsdM))).toFixed(1)
  // Sun elevation at camera sub-point
  const camLat = cameraBbox ? (cameraBbox[0] + cameraBbox[2]) / 2 : 0
  const camLon = cameraBbox ? (cameraBbox[1] + cameraBbox[3]) / 2 : 0
  const sunEl = sunElevation(new Date(), camLat, camLon).toFixed(1)

  // Format cursor position
  const cursorDMS = cursorGeo
    ? `${toDMS(cursorGeo.lat, true)}  ${toDMS(cursorGeo.lon, false)}`
    : null
  const cursorMGRS = cursorGeo
    ? formatMGRS(toMGRSString(cursorGeo.lat, cursorGeo.lon))
    : null

  // Format camera altitude with unit
  const altStr = cameraHeight >= 10_000
    ? `${Math.round(cameraHeight / 1_000).toLocaleString()}KM`
    : cameraHeight >= 1_000
      ? `${(cameraHeight / 1_000).toFixed(1)}KM`
      : `${Math.round(cameraHeight)}M`

  return (
    <>
      {/* Crosshair reticle is now rendered as a CesiumJS billboard in App.tsx */}

      {/* Minimal: crosshair + UTC time */}
      {hudLayout === 'Minimal' && (
        <div className="absolute top-3 right-3 z-20 pointer-events-none">
          <div className="text-[11px] text-worldview-cyan font-mono tracking-wider">{utcNow}</div>
        </div>
      )}

      {/* Tactical + Full: branding, classification, stats */}
      {(hudLayout === 'Tactical' || hudLayout === 'Full') && (
        <>
          {/* Top Left Branding/ID — positioned at top of screen */}
          <div className="absolute top-3 left-3 z-20 pointer-events-none">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 rounded-full border border-worldview-cyan/40 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-worldview-cyan rounded-full" />
              </div>
              <h1 className="text-lg font-bold tracking-[0.35em] text-worldview-text-bright">W O R L D V I E W</h1>
            </div>
            <div className="text-[8px] text-[#555555] tracking-[0.25em] uppercase ml-6 mb-4">NO PLACE LEFT BEHIND</div>
            <div className="space-y-1">
              <div className="text-worldview-orange font-bold tracking-widest text-[9px]">TOP SECRET // SI-TK // NOFORN</div>
              <div className="text-[#607b9e] text-[9px] flex gap-2 font-mono">
                <span>KH11-4166</span>
                <span>OPS-4117</span>
              </div>
              <div className="text-worldview-cyan font-bold tracking-widest text-[11px] mt-1">{activeMode}</div>
            </div>
          </div>

          {/* Top Center — link icon */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <Link2 className="w-4 h-4 text-[#555555] -rotate-45" />
          </div>

          {/* Top Right Stats/Active Mode */}
          <div className="absolute top-3 right-3 z-20 text-right pointer-events-none flex flex-col items-end">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[8px] text-[#555555] tracking-widest uppercase">ACTIVE STYLE</span>
            </div>
            <div className="text-glow-cyan font-bold tracking-[0.25em] uppercase text-base mb-3">{activeMode}</div>
            <div className="pr-0 py-1 border-r-2 border-r-worldview-orange pl-4">
              <div className="text-worldview-orange text-[9px] font-bold mb-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-worldview-orange rounded-full animate-pulse" />
                REC {new Date().toISOString().slice(0, 10)} {utcNow}
              </div>
              <div className="text-[#607b9e] text-[8px] tracking-wider uppercase">ORB: 47439 PASS: DESC-179</div>
            </div>
          </div>

          {/* Bottom Left — Cursor GPS coordinates (screen corner, clear of LocationsBar/legend) */}
          <div className="absolute bottom-3 left-3 z-20 pointer-events-none space-y-0.5">
            {cursorGeo && (
              <div className="text-[9px] text-worldview-orange font-mono tracking-wider flex items-start gap-1">
                <span className="text-[#555555]">┗</span>
                <div>
                  <div>MGRS: <span className="font-bold">{cursorMGRS}</span></div>
                  <div className="ml-[2ch]">{cursorDMS}</div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Right Stats — derived from camera state */}
          <div className="absolute bottom-3 right-3 z-20 pointer-events-none text-right space-y-0.5">
            <div className="text-[9px] text-[#555555] font-mono tracking-wider">GSD: <span className="text-worldview-text-bright">{gsdStr}</span> NIIRS: <span className="text-worldview-orange">{niirs}</span></div>
            <div className="text-[9px] text-[#555555] font-mono tracking-wider">ALT: {altStr} SUN: <span className="text-worldview-orange">{sunEl}° EL</span></div>
          </div>
        </>
      )}

      {/* Full only: camera altitude readout */}
      {hudLayout === 'Full' && (
        <div className="absolute bottom-[165px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="text-[8px] text-[#555555] font-mono tracking-wider">
            CAM ALT: <span className="text-worldview-cyan">{altStr}</span> |
            LAT: <span className="text-worldview-text-bright">{cursorGeo?.lat.toFixed(4) ?? '--'}</span> |
            LON: <span className="text-worldview-text-bright">{cursorGeo?.lon.toFixed(4) ?? '--'}</span>
          </div>
        </div>
      )}
    </>
  )
}
