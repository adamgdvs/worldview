import { useEffect, useRef } from 'react'
// @ts-ignore
import {
  Viewer, Cartesian3, Cartesian2, Color,
  LabelCollection, LabelStyle, HorizontalOrigin, VerticalOrigin,
  PointPrimitiveCollection, BillboardCollection, NearFarScalar,
  Primitive, GeometryInstance, PolylineGeometry, PolylineColorAppearance,
  ColorGeometryInstanceAttribute,
  HeadingPitchRange, Matrix4, Cartographic, Ellipsoid, BoundingSphere,
  Ion, createGooglePhotorealistic3DTileset, GoogleMaps,
  Math as CesiumMath,
  ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
  WebMapTileServiceImageryProvider, ImageryLayer, GeographicTilingScheme,
  PolygonGeometry, PolygonHierarchy, PerInstanceColorAppearance, GroundPrimitive,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { SidebarLeft } from './components/SidebarLeft'
import { SidebarRight } from './components/SidebarRight'
import { StylePresetsBar } from './components/StylePresetsBar'
import { LocationsBar } from './components/LocationsBar'
import { CleanUIToggle } from './components/CleanUIToggle'
import { GpsModal } from './components/GpsModal'
import { HUD } from './components/HUD'
import { useEntities } from './hooks/useEntities'
import { useKeyboard } from './hooks/useKeyboard'
import { useStore } from './store'
import { PostProcessManager } from './systems/PostProcessing'
import { TrafficParticleSystem } from './systems/TrafficParticles'
import { CCTVProjectionSystem } from './systems/CCTVProjection'

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN
GoogleMaps.defaultApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// ─── colours ──────────────────────────────────────────────────────────────────
const COL_CIVIL    = Color.fromCssColorString('#00f0ff')  // cyan
const COL_SQUAWK   = Color.fromCssColorString('#DD4444')  // red
const COL_VESSEL   = Color.fromCssColorString('#36D977')  // green (default)
const COL_VESSEL_CARGO    = Color.fromCssColorString('#36D977')  // green
const COL_VESSEL_TANKER   = Color.fromCssColorString('#D97736')  // orange
const COL_VESSEL_PASSENGER= Color.fromCssColorString('#00F0FF')  // cyan
const COL_VESSEL_FISHING  = Color.fromCssColorString('#FFD700')  // gold
const COL_VESSEL_TUG      = Color.fromCssColorString('#A78BFA')  // purple
const COL_VESSEL_MILITARY = Color.fromCssColorString('#DD4444')  // red
const COL_VESSEL_SAILING  = Color.fromCssColorString('#F472B6')  // pink
const COL_SAT_LEO  = Color.fromCssColorString('#00F0FF')  // cyan  — LEO < 2000 km
const COL_SAT_MEO  = Color.fromCssColorString('#36D977')  // green — MEO 2000–35786 km
const COL_SAT_GEO  = Color.fromCssColorString('#D4A017')  // gold  — GEO ~35786 km
const COL_SAT_HEO  = Color.fromCssColorString('#D97736')  // orange — HEO > 35786 km
const COL_SEISMIC_LO = Color.fromCssColorString('#D97736') // orange M2.5–4.9
const COL_SEISMIC_HI = Color.fromCssColorString('#DD4444') // red    M5+
const COL_LABEL    = Color.fromCssColorString('#C8D8E8')  // pale blue-white
const COL_BG       = new Color(0.02, 0.04, 0.1, 0.75)

const MILITARY_SQUAWKS = new Set(['7500', '7600', '7700'])

// Known military callsign prefixes (partial list)
const MIL_PREFIXES = ['RCH', 'EVAC', 'SAM', 'DOOM', 'TOPCAT', 'EPIC', 'JAKE', 'IRON', 'BISON',
  'BDOG', 'HAVOC', 'BOXER', 'DUKE', 'KING', 'NAVY', 'SPAR', 'REACH', 'FORTE', 'RRR']

type AviationCategory = 'civil' | 'military' | 'helicopter' | 'uav' | 'unknown'

function classifyFlight(flight: any): AviationCategory {
  const cs = (flight.callsign ?? '').trim().toUpperCase()
  const squawk = flight.squawk ?? ''

  // Flag from ADSB data (dbFlags bit 0)
  if (flight.military) return 'military'

  // Military squawks
  if (squawk >= '5000' && squawk <= '5777') return 'military'
  if (MIL_PREFIXES.some(p => cs.startsWith(p))) return 'military'

  // Helicopter heuristic: very low speed + low altitude + not on ground
  // Also common heli callsign patterns
  if (cs.startsWith('LIF') || cs.startsWith('MED') || cs.startsWith('PHI') ||
      cs.startsWith('ERA') || cs.startsWith('N9')) {
    return 'helicopter'
  }

  // Normal civil traffic
  if (cs.length > 0) return 'civil'

  return 'unknown'
}

function formatFlightLabel(flight: any, icao: string): string {
  const cs = flight.callsign?.trim() || icao.toUpperCase()
  const fl = flight.baro_altitude != null
    ? `FL${Math.round(flight.baro_altitude * 3.28084 / 100)}`
    : ''
  const kts = flight.velocity != null
    ? `${Math.round(flight.velocity * 1.94384)} kts`
    : ''
  return [cs, fl, kts].filter(Boolean).join(' \u00B7 ')
}

type OrbitType = 'LEO' | 'MEO' | 'GEO' | 'HEO'

function classifyOrbit(altitudeKm: number): OrbitType {
  if (altitudeKm < 2_000) return 'LEO'
  if (altitudeKm < 34_000) return 'MEO'
  if (altitudeKm <= 37_000) return 'GEO'
  return 'HEO'
}

function orbitColor(type: OrbitType): Color {
  switch (type) {
    case 'LEO': return COL_SAT_LEO
    case 'MEO': return COL_SAT_MEO
    case 'GEO': return COL_SAT_GEO
    case 'HEO': return COL_SAT_HEO
  }
}

// AIS vessel type → color (based on IMO ship type codes)
function vesselTypeColor(aisType: number): Color {
  if (aisType >= 70 && aisType <= 79) return COL_VESSEL_CARGO
  if (aisType >= 80 && aisType <= 89) return COL_VESSEL_TANKER
  if (aisType >= 60 && aisType <= 69) return COL_VESSEL_PASSENGER
  if (aisType === 30) return COL_VESSEL_FISHING
  if (aisType === 31 || aisType === 32) return COL_VESSEL_TUG
  if (aisType === 35) return COL_VESSEL_MILITARY
  if (aisType === 36) return COL_VESSEL_SAILING
  if (aisType >= 40 && aisType <= 49) return COL_VESSEL_FISHING // high-speed craft often fishing
  return COL_VESSEL // default green
}

// ─── SVG icon renderers (white fill, tinted by CesiumJS billboard color) ─────

// Airplane SVG (plane.svg) — viewBox 0 0 122.88 122.88, nose points upper-right ~42° CW
const PLANE_PATH = 'M16.63,105.75c0.01-4.03,2.3-7.97,6.03-12.38L1.09,79.73c-1.36-0.59-1.33-1.42-0.54-2.4l4.57-3.9c0.83-0.51,1.71-0.73,2.66-0.47l26.62,4.5l22.18-24.02L4.8,18.41c-1.31-0.77-1.42-1.64-0.07-2.65l7.47-5.96l67.5,18.97L99.64,7.45c6.69-5.79,13.19-8.38,18.18-7.15c2.75,0.68,3.72,1.5,4.57,4.08c1.65,5.06-0.91,11.86-6.96,18.86L94.11,43.18l18.97,67.5l-5.96,7.47c-1.01,1.34-1.88,1.23-2.65-0.07L69.43,66.31L45.41,88.48l4.5,26.62c0.26,0.94,0.05,1.82-0.47,2.66l-3.9,4.57c-0.97,0.79-1.81,0.82-2.4-0.54l-13.64-21.57c-4.43,3.74-8.37,6.03-12.42,6.03C16.71,106.24,16.63,106.11,16.63,105.75L16.63,105.75z'
// SVG nose points ~42° CW from north; offset applied in billboard rotation
const PLANE_HEADING_OFFSET = 42

function createAirplaneImage(size = 32): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const vb = 122.88
  const pad = size * 0.04
  const scale = (size - pad * 2) / vb
  ctx.translate(pad, pad)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(PLANE_PATH))
  return canvas.toDataURL()
}

// Fire SVG — viewBox 0 0 24 24
const FIRE_PATH = 'M5.926 20.574a7.26 7.26 0 0 0 3.039 1.511c.107.035.179-.105.107-.175-2.395-2.285-1.079-4.758-.107-5.873.693-.796 1.68-2.107 1.608-3.865 0-.176.18-.317.322-.211 1.359.703 2.288 2.25 2.538 3.515.394-.386.537-.984.537-1.511 0-.176.214-.317.393-.176 1.287 1.16 3.503 5.097-.072 8.19-.071.071 0 .212.072.177a8.761 8.761 0 0 0 3.003-1.442c5.827-4.5 2.037-12.48-.43-15.116-.321-.317-.893-.106-.893.351-.036.95-.322 2.004-1.072 2.707-.572-2.39-2.478-5.105-5.195-6.441-.357-.176-.786.105-.75.492.07 3.27-2.063 5.352-3.922 8.059-1.645 2.425-2.717 6.89.822 9.808z'

function createFireImage(size = 24): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const scale = size / 24
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(FIRE_PATH))
  return canvas.toDataURL()
}

// Satellite SVG (satellite2.svg) — viewBox 0 0 2600 2600, potrace transform
const SAT_PATHS = [
  'M5900 23764 c-30 -8 -78 -29 -107 -46 -69 -42 -3080 -3054 -3116 -3118 -73 -127 -74 -268 -2 -410 31 -62 -304 274 4380 -4402 2790 -2786 2912 -2906 2970 -2929 50 -20 78 -24 165 -24 98 0 110 2 175 33 67 32 129 92 1602 1565 1473 1473 1533 1535 1565 1602 31 66 33 76 33 180 0 105 -2 114 -34 180 -32 67 -181 218 -3655 3691 -3184 3184 -3628 3624 -3677 3647 -104 49 -197 58 -299 31z m500 -2279 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m1430 -1430 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2887 807 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m4317 -2237 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2887 807 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m4317 -2237 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2887 807 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m4312 -2232 l-445 -445 -417 418 -418 417 445 445 445 445 417 -417 418 -418 -445 -445z m-2882 802 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m1427 -1427 l415 -415 -445 -445 -445 -445 -417 417 -418 418 442 442 c244 244 445 443 448 443 3 0 192 -187 420 -415z',
  'M14035 15690 c-131 -21 -267 -75 -370 -148 -27 -19 -768 -753 -1646 -1630 l-1596 -1594 -69 40 c-306 177 -676 306 -1044 363 -173 27 -527 37 -707 20 -574 -54 -1118 -266 -1558 -608 -127 -99 -306 -265 -341 -317 -90 -133 -97 -304 -17 -446 16 -28 335 -356 852 -872 l826 -828 -621 -622 c-534 -535 -625 -631 -647 -679 -135 -292 83 -615 404 -597 65 4 91 11 151 41 68 34 112 75 688 651 l615 616 750 -748 c868 -866 795 -807 990 -807 99 0 116 3 168 27 75 35 101 57 215 182 659 714 927 1700 721 2654 -40 186 -142 489 -208 621 -17 33 -31 66 -31 73 0 7 731 744 1624 1638 1183 1183 1635 1642 1664 1688 210 329 167 763 -105 1036 -155 156 -337 238 -554 250 -52 2 -121 1 -154 -4z',
  'M15405 14276 c-124 -30 -59 32 -1682 -1590 -1679 -1679 -1576 -1569 -1604 -1720 -16 -84 -2 -164 42 -256 30 -60 288 -321 3651 -3680 4061 -4057 3669 -3681 3843 -3688 99 -5 164 9 235 51 43 24 3059 3035 3101 3094 84 121 95 282 28 423 -29 61 -258 292 -3648 3682 -3866 3867 -3642 3648 -3778 3683 -67 18 -119 18 -188 1z m515 -1421 l415 -415 -445 -445 -445 -445 -417 417 -418 418 442 442 c244 244 445 443 448 443 3 0 192 -187 420 -415z m1430 -1430 l415 -415 -445 -445 -445 -445 -417 417 -418 418 442 442 c244 244 445 443 448 443 3 0 192 -187 420 -415z m-2945 -915 l-445 -445 -417 418 -418 417 445 445 445 445 417 -417 418 -418 -445 -445z m4345 -1375 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2915 -55 l-445 -445 -417 418 -418 417 445 445 445 445 417 -417 418 -418 -445 -445z m4345 -1375 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2887 807 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m4317 -2237 l-445 -445 -420 420 -420 420 445 445 445 445 420 -420 420 -420 -445 -445z m-2887 807 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z m1430 -1430 l417 -417 -445 -445 -445 -445 -420 420 -420 420 442 442 c244 244 445 443 448 443 3 0 193 -188 423 -418z',
  'M5390 8379 c-199 -39 -345 -237 -326 -444 7 -86 61 -296 110 -430 281 -767 967 -1367 1755 -1535 145 -31 245 -26 335 19 85 41 156 112 197 197 65 131 48 306 -40 424 -75 100 -134 133 -316 179 -66 16 -157 43 -202 60 -375 139 -702 435 -876 794 -58 119 -91 213 -127 358 -35 141 -62 198 -127 262 -101 101 -241 144 -383 116z',
  'M4170 8051 c-173 -55 -290 -216 -290 -398 0 -103 89 -421 189 -681 52 -131 202 -426 288 -562 387 -617 963 -1118 1612 -1404 242 -106 607 -221 766 -241 62 -8 170 15 237 52 144 79 237 266 210 423 -32 180 -146 303 -324 349 -311 82 -453 132 -657 235 -561 280 -996 718 -1271 1281 -93 189 -154 355 -206 559 -46 182 -82 249 -173 318 -108 83 -256 110 -381 69z',
  'M3047 7750 c-129 -22 -253 -117 -310 -237 -48 -104 -49 -198 -4 -373 221 -850 623 -1570 1220 -2187 634 -654 1428 -1114 2298 -1333 173 -43 200 -46 281 -29 292 62 429 388 268 639 -68 105 -137 146 -340 200 -994 263 -1809 840 -2365 1675 -253 381 -429 777 -550 1240 -20 77 -51 166 -68 198 -55 105 -166 183 -291 206 -66 12 -70 12 -139 1z',
]

function createSatelliteImage(size = 32): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  // SVG viewBox 2600x2600, group transform: translate(0,2600) scale(0.1,-0.1)
  const s = size / 2600
  ctx.scale(s, s)
  ctx.translate(0, 2600)
  ctx.scale(0.1, -0.1)
  ctx.fillStyle = '#ffffff'
  for (const d of SAT_PATHS) {
    ctx.fill(new Path2D(d))
  }
  return canvas.toDataURL()
}

// Boat SVG (boat.svg) — viewBox 0 0 512 512, points up
const BOAT_PATH = 'M468.976,241.453c-24.922,8.344-74.078,51.109-84.546,94.672c9.047,2.469,18.828,1.938,27.703,0.25c-32.297,59.969-85.109,83.391-111.953,91.766c-10.328,3.234-1.719,0.438-1.719,0.438c-3.641,0.922-7.5,0.109-10.469-2.188s-4.719-5.828-4.75-9.594l-0.031-2.375l-1.906-230.234h43.25c4.078,8.969,13.094,15.219,23.609,15.219c14.313,0,25.938-11.625,25.938-25.969c0-14.313-11.625-25.938-25.938-25.938c-10.516,0-19.516,6.25-23.609,15.219h-43.422l-0.422-49.313l-0.016-2.438c-0.031-4.125,2.031-8,5.484-10.297c0,0,2.125-0.797,5.484-3.641c11.875-10.125,19.422-25.156,19.422-41.938C311.085,24.719,286.367,0,256.007,0c-30.375,0-55.094,24.719-55.094,55.094c0,16.781,7.547,31.813,19.422,41.938c3.359,2.844,5.484,3.641,5.484,3.641c3.453,2.297,5.516,6.172,5.484,10.297l-0.016,2.438l-0.406,49.313h-43.438c-4.094-8.969-13.109-15.219-23.594-15.219c-14.344,0-25.953,11.625-25.953,25.938c0,14.344,11.609,25.969,25.953,25.969c10.5,0,19.5-6.25,23.594-15.219h43.25l-1.906,230.234l-0.016,2.375c-0.031,3.766-1.797,7.297-4.766,9.594s-6.828,3.109-10.469,2.188c0,0,8.609,2.797-1.719-0.438c-26.844-8.375-79.656-31.797-111.953-91.766c8.875,1.688,18.656,2.219,27.719-0.25c-10.484-43.563-59.625-86.328-84.547-94.672c-24.906,28.109-30.016,85.688-12.359,126.859c10.313-4.063,18.938-12.063,25.516-20c10.703,26.813,55.578,118.469,179.703,155.781c6.484,1.953,13.922,5.563,20.109,7.906c6.172-2.344,13.609-5.953,20.094-7.906c124.125-37.313,169-128.969,179.718-155.781c6.563,7.938,15.188,15.938,25.5,20C498.976,327.141,493.866,269.563,468.976,241.453z M68.679,329.781c1.203-2.188,1.828-3.531,1.828-3.531s0.656,0.344,1.813,0.906L68.679,329.781z M256.007,82.094c-14.891,0-27.016-12.109-27.016-27c0-14.906,12.125-27,27.016-27s27,12.094,27,27C283.007,69.984,270.898,82.094,256.007,82.094z M439.694,327.156c1.156-0.563,1.797-0.906,1.797-0.906s0.641,1.344,1.828,3.531L439.694,327.156z'

function createBoatImage(size = 28): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const scale = size / 512
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(BOAT_PATH))
  return canvas.toDataURL()
}

// Seismic pulse ring — translucent ring for pulsing animation
function createPulseRingImage(size = 48): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2, cy = size / 2, r = size / 2 - 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
  return canvas.toDataURL()
}

// Seismic dot — filled circle for the center point
function createSeismicDotImage(size = 16): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.6, '#ffffff')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL()
}

function App() {
  const cesiumContainer = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)

  // ── GPU primitive collection refs ──────────────────────────────────────────
  const airplaneImageRef    = useRef<string | null>(null)
  const fireImageRef        = useRef<string | null>(null)
  const satImageRef         = useRef<string | null>(null)
  const boatImageRef        = useRef<string | null>(null)
  const flightBillboardsRef = useRef<BillboardCollection | null>(null)
  const flightLabelsRef     = useRef<LabelCollection | null>(null)
  const vesselBillboardsRef = useRef<BillboardCollection | null>(null)
  const vesselLabelsRef  = useRef<LabelCollection | null>(null)
  const seismicPointsRef = useRef<PointPrimitiveCollection | null>(null)
  const seismicPulseRef  = useRef<BillboardCollection | null>(null)
  const seismicDotImageRef  = useRef<string | null>(null)
  const pulseRingImageRef   = useRef<string | null>(null)
  const fireBillboardsRef = useRef<BillboardCollection | null>(null)
  const satBillboardsRef  = useRef<BillboardCollection | null>(null)
  const satLabelsRef     = useRef<LabelCollection | null>(null)
  const milBillboardsRef  = useRef<BillboardCollection | null>(null)
  const milLabelsRef      = useRef<LabelCollection | null>(null)
  const flightTrailPrimRef = useRef<Primitive | null>(null)
  const satOrbitPrimRef    = useRef<Primitive | null>(null)
  const aqPointsRef        = useRef<PointPrimitiveCollection | null>(null)
  const aqLabelsRef        = useRef<LabelCollection | null>(null)
  const weatherPointsRef   = useRef<PointPrimitiveCollection | null>(null)
  const weatherLabelsRef   = useRef<LabelCollection | null>(null)
  const nightLightsLayerRef = useRef<ImageryLayer | null>(null)
  const gpsJamPrimRef = useRef<Primitive | null>(null)

  // ── Index maps: id → primitive (for O(1) updates) ─────────────────────────
  const flightIndexMap  = useRef<Map<string, { billboard: any; label: any }>>(new Map())
  const milIndexMap     = useRef<Map<string, { billboard: any; label: any }>>(new Map())
  const vesselIndexMap  = useRef<Map<number, any>>(new Map())
  const seismicIndexMap = useRef<Map<string, any>>(new Map())
  const fireIndexMap    = useRef<Map<string, any>>(new Map())
  const satIndexMap     = useRef<Map<string, any>>(new Map())
  const seismicPulseList = useRef<Array<{ billboard: any; baseScale: number; color: Color; startTime: number; period: number }>>([])

  // ── Flight trail history ──────────────────────────────────────────────────
  const flightTrails = useRef<Map<string, Array<{ lon: number; lat: number; alt: number; t: number }>>>(new Map())

  const postProcessRef = useRef<PostProcessManager | null>(null)
  const trafficSystemRef = useRef<TrafficParticleSystem | null>(null)
  const cctvSystemRef = useRef<CCTVProjectionSystem | null>(null)

  const { flights, militaryFlights, vessels, seismicEvents, wildfires, sats, airQuality, weather, gpsJam, roadSegments, cctvFeeds } = useEntities()
  const { selectedCity, activeLayers } = useStore()
  const activeMode = useStore((s) => s.activeMode)
  const shaderParams = useStore((s) => s.shaderParams)
  const trackedEntity = useStore((s) => s.trackedEntity)
  const showLabels = useStore((s) => s.showLabels)
  const aviationFilters = useStore((s) => s.aviationFilters)
  const trafficDensity = useStore((s) => s.trafficDensity)
  const trafficMaxParticles = useStore((s) => s.trafficMaxParticles)

  useKeyboard(viewerRef)

  // Keep refs to latest entity data for pick handler lookups
  const flightsRef = useRef(flights)
  flightsRef.current = flights
  const vesselsRef = useRef(vessels)
  vesselsRef.current = vessels
  const seismicRef = useRef(seismicEvents)
  seismicRef.current = seismicEvents
  const satsDataRef = useRef(sats)
  satsDataRef.current = sats
  const wildfiresRef = useRef(wildfires)
  wildfiresRef.current = wildfires
  const milFlightsRef = useRef(militaryFlights)
  milFlightsRef.current = militaryFlights
  const airQualityRef = useRef(airQuality)
  airQualityRef.current = airQuality
  const weatherRef = useRef(weather)
  weatherRef.current = weather
  const cctvFeedsRef = useRef(cctvFeeds)
  cctvFeedsRef.current = cctvFeeds

  // ── Viewer init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cesiumContainer.current) return

    const viewer = new Viewer(cesiumContainer.current, {
      terrainProvider: undefined,
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      baseLayer: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    })

    const creditEl = viewer.cesiumWidget.creditContainer as HTMLElement
    if (creditEl) creditEl.style.display = 'none'

    // Dark space background — matches the surrounding UI void
    viewer.scene.backgroundColor = new Color(0.008, 0.016, 0.04, 1.0)
    viewer.scene.skyBox = undefined as any
    viewer.scene.sun = undefined as any
    viewer.scene.moon = undefined as any
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false

    // Prevent camera from clipping through the globe when zooming in close
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100  // 100m minimum altitude

    viewerRef.current = viewer

    createGooglePhotorealistic3DTileset()
      .then(tileset => {
        if (!viewer.isDestroyed()) viewer.scene.primitives.add(tileset)
      })
      .catch(err => console.error('3D Tiles failed:', err))

    // ── GPU primitive collections ────────────────────────────────────────────
    const fb = new BillboardCollection()
    const fl = new LabelCollection()
    const vp = new BillboardCollection()
    const vl = new LabelCollection()
    const sp = new PointPrimitiveCollection()
    const spulse = new BillboardCollection()  // seismic pulse rings
    const fip = new BillboardCollection()
    const satp = new BillboardCollection()
    const satl = new LabelCollection()
    const mb = new BillboardCollection()
    const ml = new LabelCollection()
    const aqp = new PointPrimitiveCollection()
    const aql = new LabelCollection()
    const wxp = new PointPrimitiveCollection()
    const wxl = new LabelCollection()

    for (const c of [fb, fl, vp, vl, sp, spulse, fip, satp, satl, mb, ml, aqp, aql, wxp, wxl]) {
      viewer.scene.primitives.add(c)
    }

    flightBillboardsRef.current = fb
    flightLabelsRef.current  = fl
    vesselBillboardsRef.current  = vp
    vesselLabelsRef.current  = vl
    seismicPointsRef.current = sp
    seismicPulseRef.current  = spulse
    fireBillboardsRef.current = fip
    satBillboardsRef.current  = satp
    satLabelsRef.current     = satl
    milBillboardsRef.current  = mb
    milLabelsRef.current     = ml
    aqPointsRef.current      = aqp
    aqLabelsRef.current      = aql
    weatherPointsRef.current = wxp
    weatherLabelsRef.current = wxl

    // Pre-render seismic images
    seismicDotImageRef.current  = createSeismicDotImage(16)
    pulseRingImageRef.current   = createPulseRingImage(48)

    // ── Post-processing shaders ────────────────────────────────────────────
    const ppManager = new PostProcessManager(viewer)
    ppManager.setMode(useStore.getState().activeMode)
    ppManager.setParams(useStore.getState().shaderParams)
    postProcessRef.current = ppManager

    // ── Traffic particle system ──────────────────────────────────────────
    const trafficSys = new TrafficParticleSystem(viewer)
    trafficSystemRef.current = trafficSys

    // ── CCTV projection system ───────────────────────────────────────────
    const cctvSys = new CCTVProjectionSystem(viewer)
    cctvSystemRef.current = cctvSys

    // ── Animation loop (seismic pulses + traffic particles) ─────────────────
    let animFrame: number | null = null
    let lastAnimTime = performance.now()
    const animateLoop = () => {
      const now = performance.now()
      const dt = (now - lastAnimTime) / 1000 // seconds
      lastAnimTime = now

      // Seismic pulse animation
      const pulses = seismicPulseList.current
      if (pulses.length > 0) {
        const nowMs = Date.now()
        let needsRender = false
        for (const pulse of pulses) {
          const elapsed = (nowMs - pulse.startTime) % pulse.period
          const t = elapsed / pulse.period  // 0 → 1
          const scale = pulse.baseScale * (1.0 + t * 2.5)  // expand 1× → 3.5×
          const alpha = 0.7 * (1.0 - t)  // fade from 0.7 → 0
          pulse.billboard.scale = scale
          pulse.billboard.color = Color.fromAlpha(pulse.color, alpha)
          needsRender = true
        }
        if (needsRender) viewer.scene.requestRender()
      }

      // Traffic particle system
      trafficSys.update(dt)

      animFrame = requestAnimationFrame(animateLoop)
    }
    animFrame = requestAnimationFrame(animateLoop)

    // ── Click-to-inspect: pick handler ───────────────────────────────────────
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(click.position)
      if (defined(picked) && picked.primitive?.id) {
        const { type, key } = picked.primitive.id
        let data: any = null

        if (type === 'flight') {
          data = flightsRef.current.get(key) ?? milFlightsRef.current.get(key)
        } else if (type === 'vessel') {
          data = vesselsRef.current.get(key)
        } else if (type === 'seismic') {
          data = seismicRef.current.find((e: any) => e.id === key)
        } else if (type === 'satellite') {
          data = satsDataRef.current.find((s: any) => s.id === key)
        } else if (type === 'wildfire') {
          const idx = parseInt(key.replace('fire-', ''), 10)
          data = wildfiresRef.current[idx]
        } else if (type === 'airq') {
          data = airQualityRef.current.find((s: any) => String(s.id) === key)
        } else if (type === 'weather') {
          data = weatherRef.current.find((w: any) => w.id === key)
        } else if (type === 'cctv') {
          data = cctvFeedsRef.current.find((f: any) => f.id === key)
        }

        if (data) {
          useStore.getState().setSelectedEntity({ type, data })
        }
      } else {
        useStore.getState().setSelectedEntity(null)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      if (animFrame != null) cancelAnimationFrame(animFrame)
      ppManager.destroy()
      trafficSys.destroy()
      cctvSys.destroy()
      handler.destroy()
      viewer.destroy()
    }
  }, [])

  // ── Post-processing mode sync ───────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setMode(activeMode)
  }, [activeMode])

  // ── Post-processing params sync ────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setParams(shaderParams)
  }, [shaderParams])

  // ── Label visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const collections = [flightLabelsRef, milLabelsRef, vesselLabelsRef, satLabelsRef]
    for (const ref of collections) {
      if (ref.current) ref.current.show = showLabels
    }
    viewerRef.current?.scene.requestRender()
  }, [showLabels])

  // ── Traffic system sync ────────────────────────────────────────────────────
  useEffect(() => {
    trafficSystemRef.current?.setRoadNetwork(roadSegments)
  }, [roadSegments])

  useEffect(() => {
    trafficSystemRef.current?.setDensity(trafficDensity)
  }, [trafficDensity])

  useEffect(() => {
    trafficSystemRef.current?.setMaxParticles(trafficMaxParticles)
  }, [trafficMaxParticles])

  // ── CCTV system sync ─────────────────────────────────────────────────────
  useEffect(() => {
    cctvSystemRef.current?.setFeeds(cctvFeeds)
  }, [cctvFeeds])

  // ── Camera: fly to selected city (Nominatim smart centering) ────────────────
  // Fallback coords used when Nominatim is unavailable or for Global view
  const CITY_FALLBACKS: Record<string, { lat: number; lon: number; height: number; pitch: number }> = {
    'Austin':        { lat: 30.2672, lon: -97.7431,  height: 1_200,      pitch: -35 },
    'New York':      { lat: 40.7128, lon: -74.0060,  height: 1_000,      pitch: -30 },
    'Tokyo':         { lat: 35.6762, lon: 139.6503,  height: 1_500,      pitch: -35 },
    'London':        { lat: 51.5074, lon: -0.1278,   height: 1_200,      pitch: -30 },
    'Paris':         { lat: 48.8566, lon: 2.3522,    height: 1_200,      pitch: -30 },
    'Dubai':         { lat: 25.2048, lon: 55.2708,   height: 1_500,      pitch: -35 },
    'Washington DC': { lat: 38.9072, lon: -77.0369,  height: 1_500,      pitch: -35 },
    'San Francisco': { lat: 37.7749, lon: -122.4194, height: 1_200,      pitch: -35 },
    'Hong Kong':     { lat: 22.3193, lon: 114.1694,  height: 1_200,      pitch: -30 },
    'Singapore':     { lat: 1.3521,  lon: 103.8198,  height: 1_200,      pitch: -30 },
    'Global':        { lat: 20,      lon: 0,          height: 25_000_000, pitch: -90 },
  }

  // Cache Nominatim results in-memory so we only query once per city
  const nominatimCache = useRef<Map<string, { lat: number; lon: number; height: number; pitch: number }>>(new Map())

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !selectedCity) return

    // Clear any active tracking when navigating to a city
    useStore.getState().setTrackedEntity(null)

    // Global view — use fallback directly
    if (selectedCity === 'Global') {
      const g = CITY_FALLBACKS['Global']
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(g.lon, g.lat, g.height),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(g.pitch), roll: 0 },
        duration: 3,
      })
      return
    }

    // If we've already geocoded this query, use cached result
    // Skip cache for preset cities (always fast) and non-preset queries
    // that may have been cached from a failed fallback
    const isPreset = (CITY_FALLBACKS as Record<string, any>)[selectedCity] !== undefined
    if (isPreset && nominatimCache.current.has(selectedCity)) {
      const cached = nominatimCache.current.get(selectedCity)!
      flyToCity(viewer, cached)
      return
    }

    // Geocode via Google Geocoding API (primary) with Nominatim fallback
    const controller = new AbortController()
    const fetchOpts = { signal: controller.signal }
    const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

    const geocodeWithGoogle = async (): Promise<boolean> => {
      if (!googleKey) return false
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(selectedCity)}&key=${googleKey}`
        const res = await fetch(url, fetchOpts)
        const data = await res.json()
        if (data.status !== 'OK' || !data.results?.[0] || viewer.isDestroyed()) return false

        const result = data.results[0]
        const { lat, lng } = result.geometry.location
        const locType = result.geometry.location_type // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
        const vp = result.geometry.viewport

        let height: number
        let pitch: number

        if (locType === 'ROOFTOP' || locType === 'RANGE_INTERPOLATED') {
          // Exact address — zoom in close to street level
          height = 250
          pitch = -30
        } else if (vp) {
          const sw = Cartographic.fromDegrees(vp.southwest.lng, vp.southwest.lat)
          const ne = Cartographic.fromDegrees(vp.northeast.lng, vp.northeast.lat)
          const swCart = Ellipsoid.WGS84.cartographicToCartesian(sw)
          const neCart = Ellipsoid.WGS84.cartographicToCartesian(ne)
          const diagonal = Cartesian3.distance(swCart, neCart)
          height = Math.max(diagonal * 0.6, 500)
          pitch = height > 50_000 ? -60 : height > 5_000 ? -40 : -35
        } else {
          height = 2000
          pitch = -35
        }

        const cityData = { lat, lon: lng, height, pitch }
        nominatimCache.current.set(selectedCity, cityData)
        flyToCity(viewer, cityData)
        return true
      } catch {
        return false
      }
    }

    const geocodeWithNominatim = async (): Promise<boolean> => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(selectedCity)}&format=json&limit=1`
        const res = await fetch(url, { ...fetchOpts, headers: { 'User-Agent': 'Worldview/1.0' } })
        const results = await res.json()
        if (!results?.[0]?.boundingbox || viewer.isDestroyed()) return false

        const bb = results[0].boundingbox
        const south = parseFloat(bb[0]), north = parseFloat(bb[1])
        const west = parseFloat(bb[2]), east = parseFloat(bb[3])
        const centerLat = (south + north) / 2
        const centerLon = (west + east) / 2
        const sw = Cartographic.fromDegrees(west, south)
        const ne = Cartographic.fromDegrees(east, north)
        const swCart = Ellipsoid.WGS84.cartographicToCartesian(sw)
        const neCart = Ellipsoid.WGS84.cartographicToCartesian(ne)
        const diagonal = Cartesian3.distance(swCart, neCart)
        const height = Math.max(diagonal * 0.6, 500)
        const pitch = height > 50_000 ? -60 : height > 5_000 ? -40 : -35
        const cityData = { lat: centerLat, lon: centerLon, height, pitch }
        nominatimCache.current.set(selectedCity, cityData)
        flyToCity(viewer, cityData)
        return true
      } catch {
        return false
      }
    }

    ;(async () => {
      // Try Google first, fall back to Nominatim
      if (await geocodeWithGoogle()) return
      if (await geocodeWithNominatim()) return

      // Final fallback to preset or Global
      if (!viewer.isDestroyed()) {
        flyToCity(viewer, CITY_FALLBACKS[selectedCity] ?? CITY_FALLBACKS['Global'])
      }
    })()

    return () => controller.abort()
  }, [selectedCity])

  function flyToCity(viewer: Viewer, city: { lat: number; lon: number; height: number; pitch: number }) {
    if (city.height <= 500) {
      // For close-up views (addresses), use flyToBoundingSphere so the target
      // stays centered on screen even with a tilted pitch
      const target = Cartesian3.fromDegrees(city.lon, city.lat, 0)
      viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(0),
          CesiumMath.toRadians(city.pitch),
          city.height
        ),
        duration: 2.5,
      })
    } else {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(city.lon, city.lat, city.height),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch:   CesiumMath.toRadians(city.pitch),
          roll: 0,
        },
        duration: 2.5,
        easingFunction: (CesiumMath as any).EASE_IN_OUT_SINE,
      })
    }
  }

  // ── Track entity: follow selected flight/satellite ─────────────────────────
  const trackInitRef = useRef<string | null>(null) // key of entity we've already flown to

  // Helper: use lookAt to compute correct camera position aimed at target,
  // then immediately release the transform so primitives stay in world coords.
  function pointCameraAt(viewer: Viewer, target: Cartesian3, offset: HeadingPitchRange) {
    viewer.camera.lookAt(target, offset)
    // Capture world-coordinate camera state before releasing transform
    const posWC = Cartesian3.clone(viewer.camera.positionWC)
    const dirWC = Cartesian3.clone(viewer.camera.directionWC)
    const upWC  = Cartesian3.clone(viewer.camera.upWC)
    // Release the reference frame lock
    viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    // Apply the computed world-coordinate position/orientation
    viewer.camera.position  = posWC
    viewer.camera.direction = dirWC
    viewer.camera.up        = upWC
  }

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!trackedEntity) {
      trackInitRef.current = null
      return
    }

    let lon: number | null = null
    let lat: number | null = null
    let alt = 0
    let heading = 0
    let range = 15_000     // default: 15km for flights (shows ground tiles)
    let camPitchDeg = -45  // default: moderate angle to see ground

    if (trackedEntity.type === 'flight') {
      const f = flightsRef.current.get(trackedEntity.key) ?? milFlightsRef.current.get(trackedEntity.key)
      if (f && f.longitude != null && f.latitude != null) {
        lon = f.longitude
        lat = f.latitude
        const rawAlt = f.baro_altitude ?? f.geo_altitude ?? 0
        alt = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
        heading = f.true_track ?? 0
        // Auto-adjust range based on altitude: higher flights get wider view
        range = Math.max(8_000, alt * 1.5 + 5_000)
        range = Math.min(range, 50_000) // cap at 50km
        camPitchDeg = -45
      }
    } else if (trackedEntity.type === 'vessel') {
      const v = vesselsRef.current.get(Number(trackedEntity.key))
      if (v && v.longitude != null && v.latitude != null) {
        lon = v.longitude
        lat = v.latitude
        alt = 0
        heading = v.course ?? 0
        range = 3_000     // 3km for surface vessels — close enough to see detail
        camPitchDeg = -40 // shallower angle to see horizon + ground
      }
    } else if (trackedEntity.type === 'satellite') {
      const s = satsDataRef.current.find(s => s.id === trackedEntity.key)
      if (s) {
        lon = s.longitude
        lat = s.latitude
        alt = s.altitudeKm * 1000
        range = Math.min(alt * 0.5, 500_000) // half of orbital altitude, capped at 500km
        camPitchDeg = -55
      }
    }

    if (lon == null || lat == null) return

    const target = Cartesian3.fromDegrees(lon, lat, alt)
    const camHeading = (trackedEntity.type === 'flight' || trackedEntity.type === 'vessel')
      ? CesiumMath.toRadians(heading)
      : 0
    const camPitch = CesiumMath.toRadians(camPitchDeg)
    const offset = new HeadingPitchRange(camHeading, camPitch, range)

    const isFirstTrack = trackInitRef.current !== trackedEntity.key

    if (isFirstTrack) {
      // Initial acquisition: animated flyTo
      trackInitRef.current = trackedEntity.key
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, alt + range),
        orientation: { heading: camHeading, pitch: camPitch, roll: 0 },
        duration: 1.5,
        complete: () => {
          if (!viewer.isDestroyed() && trackInitRef.current === trackedEntity.key) {
            pointCameraAt(viewer, target, offset)
            viewer.scene.requestRender()
          }
        },
      })
    } else {
      // Subsequent updates: reposition camera smoothly at target
      pointCameraAt(viewer, target, offset)
      viewer.scene.requestRender()
    }
  }, [trackedEntity, flights, militaryFlights, vessels, sats])

  // ── Aviation sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const fb = flightBillboardsRef.current
    const fl = flightLabelsRef.current
    if (!fb || !fl) return

    // Lazily create the airplane image once (data URL for reliability)
    if (!airplaneImageRef.current) {
      airplaneImageRef.current = createAirplaneImage(32)
    }
    const planeImg = airplaneImageRef.current

    // Apply aviation category filters
    const incoming = new Map<string, any>()
    flights.forEach((flight, icao) => {
      const cat = classifyFlight(flight)
      if (aviationFilters.has(cat)) incoming.set(icao, flight)
    })
    const existing = flightIndexMap.current

    console.info(`[Aviation Sync] ${incoming.size}/${flights.size} flights after filter`)

    incoming.forEach((flight, icao) => {
      const rawAlt = flight.baro_altitude ?? flight.geo_altitude ?? 0
      const alt = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
      const pos = Cartesian3.fromDegrees(flight.longitude!, flight.latitude!, alt)
      const isEmergency = flight.squawk ? MILITARY_SQUAWKS.has(flight.squawk) : false
      const color = isEmergency ? COL_SQUAWK : COL_CIVIL
      // CesiumJS billboard rotation is CCW radians from up; aircraft heading is CW from north
      const rotation = -((flight.true_track ?? 0) - PLANE_HEADING_OFFSET) * Math.PI / 180

      if (existing.has(icao)) {
        const { billboard, label } = existing.get(icao)!
        billboard.position = pos
        billboard.color = color
        billboard.rotation = rotation
        label.position = pos
        label.text = formatFlightLabel(flight, icao)
      } else {
        const entityId = { type: 'flight', key: icao }
        const billboard = fb.add({
          position: pos,
          image: planeImg,
          rotation,
          color,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e3, 1.4, 8e6, 0.5),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = fl.add({
          position: pos,
          text: formatFlightLabel(flight, icao),
          font: '10px "JetBrains Mono", monospace',
          fillColor: COL_LABEL,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(12, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
        })
        existing.set(icao, { billboard, label })
      }
    })

    for (const [icao, { billboard, label }] of existing) {
      if (!incoming.has(icao)) {
        fb.remove(billboard)
        fl.remove(label)
        existing.delete(icao)
      }
    }

    // ── Trail accumulation + polyline rendering ──────────────────────────────
    const trails = flightTrails.current
    const now = Date.now()
    const maxAge = 60 * 60_000 // 60 minutes

    // Append current positions (civil + military)
    const allCurrent = new Map(incoming)
    militaryFlights.forEach((f, k) => allCurrent.set(k, f))

    allCurrent.forEach((flight, icao) => {
      if (flight.longitude == null || flight.latitude == null) return
      const rawAlt = flight.baro_altitude ?? flight.geo_altitude ?? 0
      const altVal = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
      let trail = trails.get(icao)
      if (!trail) { trail = []; trails.set(icao, trail) }
      trail.push({ lon: flight.longitude, lat: flight.latitude, alt: altVal, t: now })
    })

    // Prune old entries + vanished flights
    for (const [icao, trail] of trails) {
      const pruned = trail.filter(p => now - p.t < maxAge)
      if (pruned.length === 0 || !allCurrent.has(icao)) {
        trails.delete(icao)
      } else {
        trails.set(icao, pruned)
      }
    }

    // Rebuild trail polylines as a Primitive
    const viewer = viewerRef.current
    if (viewer && !viewer.isDestroyed()) {
      if (flightTrailPrimRef.current) {
        viewer.scene.primitives.remove(flightTrailPrimRef.current)
        flightTrailPrimRef.current = null
      }

      const instances: GeometryInstance[] = []
      const milSet = new Set(militaryFlights.keys())
      for (const [icao, trail] of trails) {
        if (trail.length < 2) continue
        const baseColor = milSet.has(icao) ? COL_SQUAWK : COL_CIVIL
        // Split trail into segments of ~5 points each, with fading alpha
        // Newest points = bright, oldest = dim
        const segSize = Math.max(5, Math.floor(trail.length / 6))
        for (let i = 0; i < trail.length - 1; i += segSize) {
          const end = Math.min(i + segSize + 1, trail.length)
          if (end - i < 2) continue
          const coords: number[] = []
          for (let j = i; j < end; j++) {
            coords.push(trail[j].lon, trail[j].lat, trail[j].alt)
          }
          // Alpha fades: segment at end of trail (newest) = bright, start (oldest) = dim
          const midIdx = (i + end) / 2
          const t = midIdx / trail.length  // 0=oldest, 1=newest
          const alpha = 0.1 + t * 0.5      // 0.1 → 0.6
          instances.push(new GeometryInstance({
            geometry: new PolylineGeometry({
              positions: Cartesian3.fromDegreesArrayHeights(coords),
              width: 1.5,
            }),
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(baseColor.withAlpha(alpha)),
            },
          }))
        }
      }

      if (instances.length > 0) {
        const prim = new Primitive({
          geometryInstances: instances,
          appearance: new PolylineColorAppearance(),
          asynchronous: true,
        })
        viewer.scene.primitives.add(prim)
        flightTrailPrimRef.current = prim
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [flights, militaryFlights, aviationFilters])

  // ── Military Aviation sync ──────────────────────────────────────────────────
  useEffect(() => {
    const mb = milBillboardsRef.current
    const ml = milLabelsRef.current
    if (!mb || !ml) return

    if (!airplaneImageRef.current) {
      airplaneImageRef.current = createAirplaneImage(32)
    }
    const planeImg = airplaneImageRef.current

    // Military flights only shown when 'military' filter is active
    const incoming = new Map<string, any>()
    if (aviationFilters.has('military')) {
      militaryFlights.forEach((f, k) => incoming.set(k, f))
    }
    const existing = milIndexMap.current

    incoming.forEach((flight, icao) => {
      const rawAlt = flight.baro_altitude ?? flight.geo_altitude ?? 0
      const alt = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
      const pos = Cartesian3.fromDegrees(flight.longitude!, flight.latitude!, alt)
      const rotation = -((flight.true_track ?? 0) - PLANE_HEADING_OFFSET) * Math.PI / 180

      if (existing.has(icao)) {
        const { billboard, label } = existing.get(icao)!
        billboard.position = pos
        billboard.rotation = rotation
        label.position = pos
        label.text = formatFlightLabel(flight, icao)
      } else {
        const entityId = { type: 'flight', key: icao }
        const billboard = mb.add({
          position: pos,
          image: planeImg,
          rotation,
          color: COL_SQUAWK,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e3, 1.4, 8e6, 0.5),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = ml.add({
          position: pos,
          text: formatFlightLabel(flight, icao),
          font: '10px "JetBrains Mono", monospace',
          fillColor: COL_SQUAWK,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(12, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
        })
        existing.set(icao, { billboard, label })
      }
    })

    for (const [icao, { billboard, label }] of existing) {
      if (!incoming.has(icao)) {
        mb.remove(billboard)
        ml.remove(label)
        existing.delete(icao)
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [militaryFlights, aviationFilters])

  // ── Maritime sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const vp = vesselBillboardsRef.current
    const vl = vesselLabelsRef.current
    if (!vp || !vl) return

    if (!boatImageRef.current) {
      boatImageRef.current = createBoatImage(28)
    }
    const boatImg = boatImageRef.current

    const incoming = vessels
    const existing = vesselIndexMap.current

    incoming.forEach((vessel, mmsi) => {
      const pos = Cartesian3.fromDegrees(vessel.longitude, vessel.latitude, 0)
      // course (COG) is CW from north, same as aircraft true_track
      const rotation = vessel.course != null ? -(vessel.course * Math.PI / 180) : 0

      const col = vesselTypeColor(vessel.type)

      if (existing.has(mmsi)) {
        const { billboard, label } = existing.get(mmsi)!
        billboard.position = pos
        billboard.rotation = rotation
        billboard.color = col
        label.position = pos
        label.fillColor = col
      } else {
        const entityId = { type: 'vessel', key: mmsi }
        const billboard = vp.add({
          position: pos,
          image: boatImg,
          rotation,
          color: col,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e3, 1.4, 8e6, 0.5),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = vl.add({
          position: pos,
          text: vessel.name || String(mmsi),
          font: '9px "JetBrains Mono", monospace',
          fillColor: col,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
        })
        existing.set(mmsi, { billboard, label })
      }
    })

    for (const [mmsi, { billboard, label }] of existing) {
      if (!incoming.has(mmsi)) {
        vp.remove(billboard)
        vl.remove(label)
        existing.delete(mmsi)
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [vessels])

  // ── Seismic sync (dots + pulse rings) ────────────────────────────────────
  useEffect(() => {
    const sp = seismicPointsRef.current
    const spulse = seismicPulseRef.current
    if (!sp) return

    // Full replace — seismic events list changes as a whole
    sp.removeAll()
    if (spulse) spulse.removeAll()
    seismicIndexMap.current.clear()
    seismicPulseList.current = []

    const ringImg = pulseRingImageRef.current
    const now = Date.now()

    for (const evt of seismicEvents) {
      const pos = Cartesian3.fromDegrees(evt.longitude, evt.latitude, 0)
      const mag = evt.magnitude
      const color = mag >= 5 ? COL_SEISMIC_HI : COL_SEISMIC_LO
      // Scale pixel size 4–12 based on magnitude 2.5–7+
      const size = Math.min(4 + (mag - 2.5) * 2, 14)

      // Center dot (static point)
      const point = sp.add({
        position: pos,
        color,
        pixelSize: size,
        id: { type: 'seismic', key: evt.id },
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        scaleByDistance: new NearFarScalar(1e4, 1.5, 2e7, 0.8),
      })
      seismicIndexMap.current.set(evt.id, point)

      // Animated pulse ring billboard
      if (spulse && ringImg) {
        // Base scale proportional to magnitude (bigger quakes → bigger rings)
        const baseScale = 0.3 + (mag - 2.5) * 0.15
        // Period: smaller quakes pulse slower, bigger quakes pulse faster
        const period = Math.max(3000 - (mag - 2.5) * 400, 1200)
        // Stagger start time so not all rings pulse in unison
        const stagger = Math.random() * period

        const bb = spulse.add({
          position: pos,
          image: ringImg,
          scale: baseScale,
          color: Color.fromAlpha(color, 0.7),
          id: { type: 'seismic', key: evt.id },
          scaleByDistance: new NearFarScalar(1e4, 1.5, 2e7, 0.6),
        })

        seismicPulseList.current.push({
          billboard: bb,
          baseScale,
          color,
          startTime: now - stagger,
          period,
        })
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [seismicEvents])

  // ── Wildfire sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fip = fireBillboardsRef.current
    if (!fip) return

    if (!fireImageRef.current) {
      fireImageRef.current = createFireImage(24)
    }
    const fireImg = fireImageRef.current

    fip.removeAll()
    fireIndexMap.current.clear()

    // Cap at 15k fires — beyond that, skip low-confidence detections
    let firesToRender = wildfires
    if (firesToRender.length > 15_000) {
      firesToRender = wildfires.filter(f => f.confidence !== 'l').slice(0, 15_000)
    }

    for (let i = 0; i < firesToRender.length; i++) {
      const fire = firesToRender[i]
      const pos = Cartesian3.fromDegrees(fire.longitude, fire.latitude, 0)
      // Vary alpha by confidence: high=1.0, nominal=0.75, low=0.5
      const alpha = fire.confidence === 'h' ? 1.0 : fire.confidence === 'n' ? 0.75 : 0.5
      const color = new Color(1.0, 0.42, 0.17, alpha) // orange-red

      const fireKey = `fire-${i}`
      const billboard = fip.add({
        position: pos,
        image: fireImg,
        color,
        id: { type: 'wildfire', key: fireKey },
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(1e4, 1.2, 2e7, 0.5),
        translucencyByDistance: new NearFarScalar(1e5, 1.0, 2e7, 0.25),
      })
      fireIndexMap.current.set(fireKey, billboard)
    }

    viewerRef.current?.scene.requestRender()
  }, [wildfires])

  // ── Satellite sync (differential — runs every 3s) ────────────────────────
  useEffect(() => {
    const satp = satBillboardsRef.current
    const satl = satLabelsRef.current
    if (!satp || !satl) return

    // When sats is empty, clear everything immediately
    if (sats.length === 0) {
      satp.removeAll()
      satl.removeAll()
      satIndexMap.current.clear()
      viewerRef.current?.scene.requestRender()
      return
    }

    if (!satImageRef.current) {
      satImageRef.current = createSatelliteImage(32)
    }
    const satImg = satImageRef.current

    const existing = satIndexMap.current
    const incomingIds = new Set<string>()

    for (const sat of sats) {
      incomingIds.add(sat.id)
      const altM = sat.altitudeKm * 1000
      const pos = Cartesian3.fromDegrees(sat.longitude, sat.latitude, altM)
      const col = orbitColor(classifyOrbit(sat.altitudeKm))

      if (existing.has(sat.id)) {
        // Update position + color in-place (no GPU buffer rebuild)
        const { billboard, label } = existing.get(sat.id)!
        billboard.position = pos
        billboard.color = col
        label.position = pos
        label.fillColor = col
      } else {
        const entityId = { type: 'satellite', key: sat.id }
        const billboard = satp.add({
          position: pos,
          image: satImg,
          color: col,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e5, 2.0, 4e7, 1.0),
          translucencyByDistance: new NearFarScalar(1e5, 1.0, 4e7, 0.85),
        })
        const label = satl.add({
          position: pos,
          text: `[SAT-${sat.id}] ${sat.name.slice(0, 12)}`,
          font: '10px "JetBrains Mono", monospace',
          fillColor: col,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          scaleByDistance: new NearFarScalar(1e5, 1.2, 4e7, 0.6),
          translucencyByDistance: new NearFarScalar(1e5, 1.0, 4e7, 0.8),
        })
        existing.set(sat.id, { billboard, label })
      }
    }

    // Remove satellites no longer in data
    for (const [id, { billboard, label }] of existing) {
      if (!incomingIds.has(id)) {
        satp.remove(billboard)
        satl.remove(label)
        existing.delete(id)
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [sats])

  // ── Orbital path polylines (rebuild only when satellite set changes) ─────
  const prevSatIdsRef = useRef<string>('__init__')
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    // Helper: remove ALL tracked orbit primitives
    const removeOrbitPrim = () => {
      if (satOrbitPrimRef.current) {
        try { viewer.scene.primitives.remove(satOrbitPrimRef.current) } catch { /* already removed */ }
        satOrbitPrimRef.current = null
      }
    }

    // If no satellites, always remove and bail
    if (sats.length === 0) {
      removeOrbitPrim()
      prevSatIdsRef.current = ''
      viewer.scene.requestRender()
      return removeOrbitPrim  // cleanup
    }

    // Build a fingerprint of the current satellite set
    const satIds = sats.filter(s => s.orbitSegments.length > 0).map(s => s.id).sort().join(',')

    // Skip rebuild if the set hasn't changed
    if (satIds === prevSatIdsRef.current) return
    prevSatIdsRef.current = satIds

    // Remove old orbit primitive first
    removeOrbitPrim()

    const orbitInstances: GeometryInstance[] = []
    for (const sat of sats) {
      if (!sat.orbitSegments || sat.orbitSegments.length === 0) continue
      const col = orbitColor(classifyOrbit(sat.altitudeKm))
      for (const segment of sat.orbitSegments) {
        if (segment.length < 6) continue
        orbitInstances.push(new GeometryInstance({
          geometry: new PolylineGeometry({
            positions: Cartesian3.fromDegreesArrayHeights(segment),
            width: 1.5,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(col.withAlpha(0.5)),
          },
        }))
      }
    }

    if (orbitInstances.length > 0) {
      const prim = new Primitive({
        geometryInstances: orbitInstances,
        appearance: new PolylineColorAppearance(),
        asynchronous: false,  // synchronous to avoid stale primitive issues
      })
      viewer.scene.primitives.add(prim)
      satOrbitPrimRef.current = prim
    }

    viewer.scene.requestRender()
    return removeOrbitPrim  // cleanup on re-run or unmount
  }, [sats])

  // ── Satellite ground footprint (coverage cone projected on surface) ──────
  const satFootprintRef = useRef<any>(null)  // CesiumJS Entity
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    // Remove previous footprint
    if (satFootprintRef.current) {
      viewer.entities.remove(satFootprintRef.current)
      satFootprintRef.current = null
    }

    // Only show footprint for tracked or selected satellites
    const satId = trackedEntity?.type === 'satellite' ? trackedEntity.key : null
    if (!satId) {
      viewer.scene.requestRender()
      return
    }

    const sat = sats.find(s => s.id === satId)
    if (!sat) return

    // Compute footprint radius on Earth's surface
    // For satellite at altitude h, minimum elevation angle θ (5° default):
    // Earth central angle = arccos(Re * cos(θ) / (Re + h)) - θ
    // Footprint radius = Re * central_angle
    const Re = 6371_000  // Earth radius in meters
    const h = sat.altitudeKm * 1000
    const minElev = 5 * Math.PI / 180  // 5° minimum elevation angle
    const cosElev = Math.cos(minElev)
    const centralAngle = Math.acos(Re * cosElev / (Re + h)) - minElev
    const footprintRadius = Re * centralAngle  // meters on surface

    if (footprintRadius <= 0 || isNaN(footprintRadius)) return

    const col = orbitColor(classifyOrbit(sat.altitudeKm))

    satFootprintRef.current = viewer.entities.add({
      position: Cartesian3.fromDegrees(sat.longitude, sat.latitude, 0),
      ellipse: {
        semiMajorAxis: footprintRadius,
        semiMinorAxis: footprintRadius,
        material: col.withAlpha(0.08),
        outline: true,
        outlineColor: col.withAlpha(0.4),
        outlineWidth: 1.5,
        height: 0,
      },
    })

    viewer.scene.requestRender()
  }, [trackedEntity, sats])

  // ── Air Quality sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const aqp = aqPointsRef.current
    const aql = aqLabelsRef.current
    if (!aqp || !aql) return

    aqp.removeAll()
    aql.removeAll()

    for (const station of airQuality) {
      const pos = Cartesian3.fromDegrees(station.longitude, station.latitude, 0)
      const color = Color.fromCssColorString(
        station.aqi <= 50  ? '#36D977' :
        station.aqi <= 100 ? '#D4A017' :
        station.aqi <= 150 ? '#D97736' :
        station.aqi <= 200 ? '#DD4444' :
        station.aqi <= 300 ? '#9966FF' : '#7E0023'
      )
      const size = Math.min(4 + station.aqi / 30, 14)

      aqp.add({
        position: pos,
        color,
        pixelSize: size,
        id: { type: 'airq', key: String(station.id) },
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        scaleByDistance: new NearFarScalar(1e4, 1.5, 2e7, 0.6),
      })

      aql.add({
        position: pos,
        text: `AQI ${station.aqi}`,
        font: '9px "JetBrains Mono", monospace',
        fillColor: color,
        id: { type: 'airq', key: String(station.id) },
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Color.BLACK,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(8, 0),
        scaleByDistance: new NearFarScalar(1e4, 1.0, 1e7, 0.4),
        translucencyByDistance: new NearFarScalar(1e4, 1.0, 2e7, 0.0),
      })
    }

    viewerRef.current?.scene.requestRender()
  }, [airQuality])

  // ── Weather sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const wxp = weatherPointsRef.current
    const wxl = weatherLabelsRef.current
    if (!wxp || !wxl) return

    wxp.removeAll()
    wxl.removeAll()

    for (const wp of weather) {
      const pos = Cartesian3.fromDegrees(wp.longitude, wp.latitude, 0)
      const color = Color.fromCssColorString(
        wp.weatherCode === 0 ? '#6699FF' :
        wp.weatherCode <= 3  ? '#8899AA' :
        wp.weatherCode <= 49 ? '#AABBCC' :
        wp.weatherCode <= 69 ? '#3388DD' :
        wp.weatherCode <= 79 ? '#CCDDFF' :
        wp.weatherCode <= 86 ? '#99AADD' :
        wp.weatherCode <= 99 ? '#FFD700' : '#6699FF'
      )

      const label =
        wp.weatherCode === 0 ? 'CLR' :
        wp.weatherCode <= 3  ? 'CLD' :
        wp.weatherCode <= 49 ? 'FOG' :
        wp.weatherCode <= 69 ? 'RN'  :
        wp.weatherCode <= 79 ? 'SN'  :
        wp.weatherCode <= 86 ? 'SHW' :
        wp.weatherCode <= 99 ? 'TS'  : '?'

      const temp = Math.round(wp.temperature)
      const wind = Math.round(wp.windSpeed)

      wxp.add({
        position: pos,
        color,
        pixelSize: 6,
        id: { type: 'weather', key: wp.id },
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        scaleByDistance: new NearFarScalar(5e5, 1.5, 2e7, 0.8),
      })

      wxl.add({
        position: pos,
        text: `${temp}° ${label} ${wind}kh`,
        font: '9px "JetBrains Mono", monospace',
        fillColor: color,
        id: { type: 'weather', key: wp.id },
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Color.BLACK,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(8, 0),
        scaleByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.4),
        translucencyByDistance: new NearFarScalar(5e5, 1.0, 2e7, 0.0),
      })
    }

    viewerRef.current?.scene.requestRender()
  }, [weather])

  // ── Night Lights toggle (NASA GIBS WMTS) ────────────────────────────────
  const wantNightLights = activeLayers.includes('nightlights')
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (wantNightLights && !nightLightsLayerRef.current) {
      const provider = new WebMapTileServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2024-01-01/500m/{TileMatrix}/{TileRow}/{TileCol}.png',
        layer: 'VIIRS_Black_Marble',
        style: 'default',
        tileMatrixSetID: '500m',
        format: 'image/png',
        maximumLevel: 8,
        tilingScheme: new GeographicTilingScheme(),
        credit: 'NASA GIBS',
      } as any)

      const layer = new ImageryLayer(provider, {
        alpha: 0.75,
      })
      viewer.imageryLayers.add(layer)
      nightLightsLayerRef.current = layer
      viewer.scene.requestRender()
    } else if (!wantNightLights && nightLightsLayerRef.current) {
      viewer.imageryLayers.remove(nightLightsLayerRef.current)
      nightLightsLayerRef.current = null
      viewer.scene.requestRender()
    }
  }, [wantNightLights])

  // ── GPS Jamming heatmap (H3 hexagon polygons) ───────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    // Remove previous primitive
    if (gpsJamPrimRef.current) {
      viewer.scene.primitives.remove(gpsJamPrimRef.current)
      gpsJamPrimRef.current = null
    }

    if (gpsJam.length === 0) {
      viewer.scene.requestRender()
      return
    }

    const instances: GeometryInstance[] = []
    for (const cell of gpsJam) {
      // cell.boundary is [[lat, lon], ...] — convert to Cartesian3 ring
      const positions = cell.boundary.map(([lat, lon]) =>
        Cartesian3.fromDegrees(lon, lat)
      )
      if (positions.length < 3) continue

      // Color by interference level
      const ratio = cell.interferenceRatio
      let color: Color
      if (ratio < 0.10) {
        color = Color.fromCssColorString('#33ff33').withAlpha(0.25)  // green — low
      } else if (ratio < 0.30) {
        color = Color.fromCssColorString('#ffff33').withAlpha(0.35)  // yellow — medium
      } else {
        color = Color.fromCssColorString('#ff3333').withAlpha(0.45)  // red — high
      }

      instances.push(new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(positions),
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(color),
        },
        id: { type: 'gpsjam', key: cell.h3Index },
      }))
    }

    if (instances.length > 0) {
      const prim = new GroundPrimitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        asynchronous: true,
      })
      viewer.scene.primitives.add(prim)
      gpsJamPrimRef.current = prim as any
    }

    viewer.scene.requestRender()
  }, [gpsJam])

  const cleanUI = useStore((s) => s.cleanUI)

  const handleGpsNavigate = (lat: number, lon: number, alt?: number) => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    useStore.getState().setTrackedEntity(null)
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, alt ?? 1_500),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-35),
        roll: 0,
      },
      duration: 2.5,
    })
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-worldview-bg starfield">
      {/* Globe viewport — inset so dark background is visible around it */}
      <div ref={cesiumContainer} className="absolute z-0" style={{
        top: '10px',
        bottom: '160px',
        left: '220px',
        right: '220px',
        borderRadius: '16px',
        overflow: 'hidden',
      }} />

      {/* HUD overlays sit on the globe area */}
      {!cleanUI && <HUD />}

      {/* Left sidebar — in dark margin */}
      {!cleanUI && <SidebarLeft />}

      {/* Right sidebar — in dark margin */}
      {!cleanUI && <SidebarRight />}

      {/* Bottom controls */}
      {!cleanUI && <LocationsBar />}
      {!cleanUI && <StylePresetsBar />}

      {cleanUI && <CleanUIToggle />}
      <GpsModal onNavigate={handleGpsNavigate} />
    </div>
  )
}

export default App
