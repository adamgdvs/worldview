import { useEffect, useRef } from 'react'
// @ts-ignore
import {
  Viewer, Cartesian3, Cartesian2, Color,
  LabelCollection, LabelStyle, HorizontalOrigin, VerticalOrigin,
  PointPrimitiveCollection, BillboardCollection, NearFarScalar,
  Primitive, GeometryInstance, PolylineGeometry, PolylineColorAppearance, PolylineCollection, Material,
  ColorGeometryInstanceAttribute,
  HeadingPitchRange, Cartographic, Ellipsoid, BoundingSphere, DistanceDisplayCondition,
  Ion, createGooglePhotorealistic3DTileset, GoogleMaps,
  Math as CesiumMath,
  ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
  Matrix4,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { SidebarLeft } from './components/SidebarLeft'
import { SidebarRight } from './components/SidebarRight'
import { StylePresetsBar } from './components/StylePresetsBar'
import { LocationsBar } from './components/LocationsBar'
import { CleanUIToggle } from './components/CleanUIToggle'
import { GpsModal } from './components/GpsModal'
import { HUD } from './components/HUD'
import { LivePlaybackToggle } from './components/LivePlaybackToggle'
import { PlaybackBar } from './components/PlaybackBar'
import { useEntities } from './hooks/useEntities'
import { usePlaybackEngine } from './hooks/usePlaybackEngine'
import { useKeyboard } from './hooks/useKeyboard'
import { useStore } from './store'
import { LANDMARKS } from './data/landmarks'
import { PostProcessManager } from './systems/PostProcessing'
import { TrafficParticleSystem } from './systems/TrafficParticles'
import { CameraOrbitSystem } from './systems/CameraOrbit'
import { EntityInterpolationSystem } from './systems/EntityInterpolation'
import { HeatmapLayer, type ColorRampStop } from './systems/HeatmapLayer'
import { TileDrapeLayer } from './systems/TileDrapeLayer'
import { fetchRadarTileTemplate } from './adapters/weather'
import { CCTVPanel } from './components/CCTVPanel'
import { EntityTrackingPanel } from './components/EntityTrackingPanel'
import { IntelFeed } from './components/IntelFeed'
import { SatellitePanel } from './components/SatellitePanel'
import { useCameras } from './hooks/useCameras'
import { type CameraFeed } from './adapters/cctv'
import { createTrafficSession, TrafficDataSampler } from './adapters/trafficTiles'
import { trackSatelliteOrbit } from './adapters/satellites'

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
const COL_BG       = new Color(0.02, 0.04, 0.1, 0.82)

const MILITARY_SQUAWKS = new Set(['7500', '7600', '7700'])

// ─── altitude-based coloring & scaling ──────────────────────────────────────
const COL_ALT_CRUISE = Color.fromCssColorString('#00D4FF')  // >=35K ft — cyan
const COL_ALT_HIGH   = Color.fromCssColorString('#00BFFF')  // >=20K ft — light blue
const COL_ALT_MID    = Color.fromCssColorString('#FFD700')  // >=10K ft — gold
const COL_ALT_LOW    = Color.fromCssColorString('#FF8C00')  // >=3K ft  — orange
const COL_ALT_GROUND = Color.fromCssColorString('#FF4444')  // <3K ft   — red

function getAltitudeColor(altMeters: number) {
  if (altMeters >= 10668) return COL_ALT_CRUISE  // 35K ft
  if (altMeters >= 6096)  return COL_ALT_HIGH    // 20K ft
  if (altMeters >= 3048)  return COL_ALT_MID     // 10K ft
  if (altMeters >= 914)   return COL_ALT_LOW     // 3K ft
  return COL_ALT_GROUND
}

function getAltitudeScale(altMeters: number): number {
  if (altMeters >= 9144) return 1.5  // 30K ft
  if (altMeters >= 4572) return 1.3  // 15K ft
  return 1.1
}

import { isMilitaryFlight } from './adapters/aviation'

type AviationCategory = 'civil' | 'military' | 'helicopter' | 'uav' | 'unknown'

function classifyFlight(flight: any): AviationCategory {
  const cs = (flight.callsign ?? '').trim().toUpperCase()

  // Military classification (shared with useEntities data split)
  if (isMilitaryFlight(flight)) return 'military'

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

// Crosshair reticle — corner brackets from crosshair.svg (viewBox 0 0 256 256)
const CROSSHAIR_PATH = 'M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8.00008,8.00008,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8.00039,8.00039,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8.00039,8.00039,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8.00039,8.00039,0,0,0,8-8V168A8.00039,8.00039,0,0,0,208,160ZM88,40H48a8.00008,8.00008,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z'

function createCrosshairImage(size = 64): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const scale = size / 256
  ctx.scale(scale, scale)
  ctx.fillStyle = '#00f0ff'
  ctx.fill(new Path2D(CROSSHAIR_PATH))
  return canvas.toDataURL()
}

function App() {
  const cesiumContainer = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tilesetRef = useRef<any>(null)

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
  const aqHeatmapRef       = useRef<HeatmapLayer | null>(null)
  const radarDrapeRef      = useRef<TileDrapeLayer | null>(null)
  const seismicLabelsRef   = useRef<LabelCollection | null>(null)
  const fireLabelsRef      = useRef<LabelCollection | null>(null)
  const cctvBillboardsRef  = useRef<BillboardCollection | null>(null)
  const cctvLabelsRef      = useRef<LabelCollection | null>(null)
  const crosshairBbRef     = useRef<BillboardCollection | null>(null)
  const crosshairImageRef  = useRef<string | null>(null)
  const crosshairBillboardRef = useRef<any>(null) // single billboard instance for per-frame updates
  const nightLightsDrapeRef = useRef<TileDrapeLayer | null>(null)
  const gpsJamHeatmapRef = useRef<HeatmapLayer | null>(null)
  const satProjectionLinesRef = useRef<PolylineCollection | null>(null)
  const satProjectionIndexMap = useRef<Map<string, any[]>>(new Map())

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
  const orbitSystemRef = useRef<CameraOrbitSystem | null>(null)
  const interpSystemRef = useRef<EntityInterpolationSystem | null>(null)
  const trafficSystemRef = useRef<TrafficParticleSystem | null>(null)
  const trafficSamplerRef = useRef<TrafficDataSampler | null>(null)
  const trafficSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cctvIconRef = useRef<string | null>(null)
  const cctvIndexMap = useRef<Map<string, { billboard: any; label: any }>>(new Map())

  const { playbackTimeRef, tick: playbackTick } = usePlaybackEngine()
  const { flights, militaryFlights, vessels, seismicEvents, wildfires, sats, airQuality, gpsJam, roadSegments } = useEntities(playbackTimeRef)
  const { selectedCity, activeLayers } = useStore()
  const selectedLandmark = useStore((s) => s.selectedLandmark)
  const citySeq = useStore((s) => s._citySeq)
  const activeMode = useStore((s) => s.activeMode)
  const shaderParams = useStore((s) => s.shaderParams)
  const trackedEntity = useStore((s) => s.trackedEntity)
  // While the initial track flyTo animates, the per-frame camera follow must
  // hold off or the two fight over the camera every frame
  const followPauseUntilRef = useRef(0)
  const showLabels = useStore((s) => s.showLabels)
  const aviationFilters = useStore((s) => s.aviationFilters)
  const trafficDensity = useStore((s) => s.trafficDensity)
  const trafficMaxParticles = useStore((s) => s.trafficMaxParticles)
  const playbackMode = useStore((s) => s.playbackMode)
  const playbackTime = useStore((s) => s.playbackTime)
  const showPlaybackTrails = useStore((s) => s.showPlaybackTrails)
  const terrainExaggeration = useStore((s) => s.terrainExaggeration)
  const bloomIntensity = useStore((s) => s.bloomIntensity)
  const pixelateSize = useStore((s) => s.pixelateSize)
  const sharpenIntensity = useStore((s) => s.sharpenIntensity)
  const showSatProjections = useStore((s) => s.showSatProjections)
  const showSatOrbits = useStore((s) => s.showSatOrbits)
  const hiddenSatCatalogs = useStore((s) => s.hiddenSatCatalogs)
  const globeViewMode = useStore((s) => s.globeViewMode)

  // ── CCTV (new multi-source system) ────────────────────────────────────────
  const wantCctv = activeLayers.includes('cctv')
  const cctvCountryFilter = useStore((s) => s.cctvCountryFilter)
  const { cameras: cctvCameras, totalOnline, totalCameras, availableCountries } = useCameras({
    enabled: wantCctv,
    countryFilter: cctvCountryFilter,
  })
  const cctvCamerasRef = useRef(cctvCameras)
  cctvCamerasRef.current = cctvCameras

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
      maximumRenderTimeChange: 0.5,  // auto-render every 500ms to settle tiles
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

    // Prevent blue pop-in/clipping at close zoom with 3D tiles
    viewer.scene.logarithmicDepthBuffer = true
    viewer.scene.globe.baseColor = new Color(0.008, 0.016, 0.04, 1.0)  // match scene bg — no blue
    viewer.scene.globe.depthTestAgainstTerrain = false
    viewer.scene.globe.showGroundAtmosphere = false

    viewerRef.current = viewer

    createGooglePhotorealistic3DTileset()
      .then(tileset => {
        if (viewer.isDestroyed()) return
        // Aggressively load higher-detail tiles sooner
        tileset.maximumScreenSpaceError = 4        // default 16 — lower = sharper
        // @ts-ignore — cacheBytes is the modern name for maximumMemoryUsage
        tileset.cacheBytes = 2048 * 1024 * 1024     // 2GB cache
        tileset.preloadFlightDestinations = true
        tileset.preloadWhenHidden = true
        tileset.preferLeaves = true
        viewer.scene.primitives.add(tileset)
        tilesetRef.current = tileset
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
    const seisL = new LabelCollection()
    const firL = new LabelCollection()
    const cctvBb = new BillboardCollection()
    const cctvL = new LabelCollection()

    const xhairBb = new BillboardCollection()

    for (const c of [fb, fl, vp, vl, sp, spulse, fip, satp, satl, mb, ml, seisL, firL, cctvBb, cctvL, xhairBb]) {
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
    seismicLabelsRef.current = seisL
    fireLabelsRef.current    = firL
    cctvBillboardsRef.current = cctvBb
    cctvLabelsRef.current    = cctvL
    crosshairBbRef.current   = xhairBb
    crosshairImageRef.current = createCrosshairImage(64)

    const satProjLines = new PolylineCollection()
    viewer.scene.primitives.add(satProjLines)
    satProjectionLinesRef.current = satProjLines

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

    // ── Google Traffic tile overlay + data sampler ───────────────────────
    const initTrafficTiles = async () => {
      try {
        const sess = await createTrafficSession()
        if (viewer.isDestroyed()) return
        console.debug('[Traffic] Session created, expiry:', new Date(sess.expiry).toISOString())

        // NOTE: no traffic ImageryLayer — imagery drapes on the ellipsoid globe,
        // which is fully occluded by the Google photorealistic 3D tileset. The
        // session is still needed for the congestion-color data sampler.

        // Create sampler and attach to particle system
        const sampler = new TrafficDataSampler(sess.session)
        trafficSamplerRef.current = sampler
        trafficSys.setSampler(sampler)

        // Schedule session refresh (60s before expiry)
        const scheduleRefresh = (expiry: number) => {
          const delay = Math.max(expiry - Date.now() - 60_000, 60_000)
          trafficSessionTimerRef.current = setTimeout(async () => {
            try {
              const newSess = await createTrafficSession()
              console.info('[Traffic] Session refreshed')
              sampler.updateSession(newSess.session)
              scheduleRefresh(newSess.expiry)
            } catch (err) {
              console.warn('[Traffic] Session refresh failed:', err)
              scheduleRefresh(Date.now() + 5 * 60_000)
            }
          }, delay)
        }
        scheduleRefresh(sess.expiry)
      } catch (err) {
        console.error('[Traffic] Failed to create Google traffic session:', err)
      }
    }
    initTrafficTiles()

    // ── Camera orbit system ─────────────────────────────────────────────
    const orbitSys = new CameraOrbitSystem()
    orbitSystemRef.current = orbitSys

    // ── Entity interpolation system ──────────────────────────────────────
    const interpSys = new EntityInterpolationSystem()
    interpSystemRef.current = interpSys

    // ── Pre-render CCTV camera icon (country colors applied per billboard) ──
    {
      const sz = 24, canvas = document.createElement('canvas')
      canvas.width = sz; canvas.height = sz
      const ctx = canvas.getContext('2d')!
      // Camera icon: simple filled circle with inner dot
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#000000'
      ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.fill()
      cctvIconRef.current = canvas.toDataURL()
    }

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

      // Entity interpolation — smooth position updates between data snapshots
      if (interpSys.tick(dt)) {
        viewer.scene.requestRender()
      }

      // Camera follow: keep tracked flight centered using interpolated position
      {
        const te = useStore.getState().trackedEntity
        if (te && (te.type === 'flight' || te.type === 'vessel') && now > followPauseUntilRef.current) {
          const prefix = te.type === 'flight' ? 'f-' : 'v-'
          // Try civil first, then military for flights
          let pos = interpSys.getPosition(`${prefix}${te.key}`)
          if (!pos && te.type === 'flight') {
            pos = interpSys.getPosition(`m-${te.key}`)
          }
          if (pos) {
            const range = te.type === 'flight' ? 8_000 : 3_000
            const camAlt = pos.alt + range
            viewer.camera.setView({
              destination: Cartesian3.fromDegrees(pos.lon, pos.lat, camAlt),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
            })
            viewer.scene.requestRender()
          }
        }
      }

      // Crosshair sync: follow entity's interpolated billboard position every frame
      {
        const xhairBb = crosshairBillboardRef.current
        if (xhairBb) {
          const se = useStore.getState().selectedEntity
          if (se) {
            let entityBb: any = null
            if (se.type === 'flight') {
              const entry = flightIndexMap.current.get(se.data.icao24) ?? milIndexMap.current.get(se.data.icao24)
              entityBb = entry?.billboard
            } else if (se.type === 'vessel') {
              const entry = vesselIndexMap.current.get(se.data.mmsi)
              entityBb = entry?.billboard
            } else if (se.type === 'satellite') {
              const entry = satIndexMap.current.get(se.data.id)
              entityBb = entry?.billboard
            }
            if (entityBb?.position) {
              xhairBb.position = entityBb.position
            }
          }
        }
      }

      // Playback engine tick — advances virtual time
      playbackTick(dt)

      // Camera orbit — only when playback mode + orbit enabled
      const pbState = useStore.getState()
      if (pbState.playbackMode && pbState.playbackOrbit && orbitSys) {
        // Look-at target: current city center
        const cityCoords: Record<string, { lat: number; lon: number }> = {
          'Austin':        { lat: 30.2672, lon: -97.7431 },
          'New York':      { lat: 40.7128, lon: -74.0060 },
          'Tokyo':         { lat: 35.6762, lon: 139.6503 },
          'London':        { lat: 51.5074, lon: -0.1278 },
          'Paris':         { lat: 48.8566, lon: 2.3522 },
          'Dubai':         { lat: 25.2048, lon: 55.2708 },
          'Washington DC': { lat: 38.9072, lon: -77.0369 },
          'San Francisco': { lat: 37.7749, lon: -122.4194 },
          'Hong Kong':     { lat: 22.3193, lon: 114.1694 },
          'Singapore':     { lat: 1.3521, lon: 103.8198 },
          'Global':        { lat: 20, lon: 0 },
        }
        const target = cityCoords[pbState.selectedCity] ?? cityCoords['Global']
        orbitSys.tick(
          dt, viewer, pbState.cameraPreset,
          pbState.cameraDistance, pbState.cameraPitch, pbState.cameraFov,
          target.lon, target.lat,
        )
      }

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
        } else if (type === 'cctv') {
          // CCTV clicks go to CCTVPanel preview, not InspectPanel
          useStore.getState().setSelectedCameraId(key)
          useStore.getState().setSelectedEntity(null)
          return
        }

        if (data) {
          useStore.getState().setSelectedEntity({ type, data })
        }
      } else {
        useStore.getState().setSelectedEntity(null)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    // ── Cursor geo position — real-time lat/lon under mouse pointer ──
    handler.setInputAction((movement: any) => {
      const ellipsoid = viewer.scene.globe.ellipsoid
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, ellipsoid)
      if (cartesian) {
        const carto = Cartographic.fromCartesian(cartesian)
        useStore.getState().setCursorGeo({
          lat: CesiumMath.toDegrees(carto.latitude),
          lon: CesiumMath.toDegrees(carto.longitude),
        })
      } else {
        useStore.getState().setCursorGeo(null)
      }
    }, ScreenSpaceEventType.MOUSE_MOVE)

    // ── Camera move listener — update cameraBbox for viewport-based data ──
    const updateCameraBbox = () => {
      try {
        const camera = viewer.camera
        const canvas = viewer.scene.canvas
        const ellipsoid = viewer.scene.globe.ellipsoid
        const height = camera.positionCartographic.height

        // Get corner positions in radians
        const corners = [
          camera.pickEllipsoid(new Cartesian2(0, 0), ellipsoid),
          camera.pickEllipsoid(new Cartesian2(canvas.clientWidth, 0), ellipsoid),
          camera.pickEllipsoid(new Cartesian2(0, canvas.clientHeight), ellipsoid),
          camera.pickEllipsoid(new Cartesian2(canvas.clientWidth, canvas.clientHeight), ellipsoid),
        ]

        const validCorners = corners.filter(Boolean)
        if (validCorners.length >= 2) {
          const cartos = validCorners.map(c => Cartographic.fromCartesian(c!, ellipsoid))
          const lats = cartos.map(c => CesiumMath.toDegrees(c.latitude))
          const lons = cartos.map(c => CesiumMath.toDegrees(c.longitude))
          // In oblique views only the near-ground corners hit the ellipsoid,
          // collapsing the bbox to ~0 area. Pad to a minimum extent scaled
          // by altitude so viewport-based fetches (Overpass traffic) get a
          // usable region.
          const minHalfExtent = Math.max(0.04, (height * 1.5) / 111_320)
          const cLat = (Math.min(...lats) + Math.max(...lats)) / 2
          const cLon = (Math.min(...lons) + Math.max(...lons)) / 2
          const bbox: [number, number, number, number] = [
            Math.min(Math.min(...lats), cLat - minHalfExtent),
            Math.min(Math.min(...lons), cLon - minHalfExtent),
            Math.max(Math.max(...lats), cLat + minHalfExtent),
            Math.max(Math.max(...lons), cLon + minHalfExtent),
          ]
          useStore.getState().setCameraBbox(bbox, height)
        } else {
          // Zoomed out (corners point to space) — use camera sub-point with estimated extent
          const centerLat = CesiumMath.toDegrees(camera.positionCartographic.latitude)
          const centerLon = CesiumMath.toDegrees(camera.positionCartographic.longitude)
          // Rough: at 3700km alt, visible extent ~60° in each direction
          const extent = Math.min(height / 100_000, 80)
          const bbox: [number, number, number, number] = [
            Math.max(centerLat - extent, -85),
            centerLon - extent,
            Math.min(centerLat + extent, 85),
            centerLon + extent,
          ]
          useStore.getState().setCameraBbox(bbox, height)
        }
      } catch {
        // Ignore — can fail during globe rotation
      }
    }
    viewer.camera.moveEnd.addEventListener(updateCameraBbox)
    // Initial bbox
    updateCameraBbox()

    // ── Oblique-view: altitude-driven pitch to keep sky in frame ──────────
    // As camera zooms in (lower altitude), tilt toward the horizon so the
    // ground doesn't fill the entire viewport. The curve:
    //   ≤ 500m    → pitch -15°  (nearly horizontal — mostly sky)
    //   ~150km    → pitch -35°
    //   ~3,500km  → pitch -55°
    //   ≥ 25,000km→ pitch -65°  (steep oblique — globe in bottom half)
    let obliqueAdjusting = false  // re-entry guard

    const applyObliquePitch = () => {
      if (obliqueAdjusting) return
      if (useStore.getState().globeViewMode !== 'oblique') return
      if (useStore.getState().playbackOrbit) return

      const cam = viewer.camera
      const alt = cam.positionCartographic.height

      const MIN_ALT = 500
      const MAX_ALT = 25_000_000
      const CLOSE_PITCH = -15   // near ground: very oblique, mostly sky
      const FAR_PITCH = -65     // global: steeper oblique, globe in bottom half

      const clamped = Math.max(MIN_ALT, Math.min(MAX_ALT, alt))
      // Logarithmic 0..1, then sqrt for faster initial steepening
      const tLinear = Math.log(clamped / MIN_ALT) / Math.log(MAX_ALT / MIN_ALT)
      const t = Math.sqrt(tLinear)
      const targetPitchDeg = CLOSE_PITCH + t * (FAR_PITCH - CLOSE_PITCH)
      const targetPitchRad = CesiumMath.toRadians(targetPitchDeg)

      // Only adjust if pitch differs meaningfully (>2°)
      if (Math.abs(cam.pitch - targetPitchRad) > CesiumMath.toRadians(2)) {
        obliqueAdjusting = true
        cam.setView({
          destination: cam.positionWC.clone(),
          orientation: {
            heading: cam.heading,
            pitch: targetPitchRad,
            roll: cam.roll,
          },
        })
        obliqueAdjusting = false
      }
    }

    viewer.camera.moveEnd.addEventListener(applyObliquePitch)

    return () => {
      viewer.camera.moveEnd.removeEventListener(applyObliquePitch)
      viewer.camera.moveEnd.removeEventListener(updateCameraBbox)
      if (animFrame != null) cancelAnimationFrame(animFrame)
      ppManager.destroy()
      trafficSys.destroy()
      if (trafficSessionTimerRef.current) clearTimeout(trafficSessionTimerRef.current)
      trafficSamplerRef.current?.clear()
      handler.destroy()
      viewer.destroy()
    }
  }, [])

  // ── Orbit system reset when toggled on ─────────────────────────────────────
  const playbackOrbit = useStore((s) => s.playbackOrbit)
  const pbCameraDistance = useStore((s) => s.cameraDistance)
  useEffect(() => {
    if (playbackOrbit) {
      orbitSystemRef.current?.reset()
      // Unlock camera from any previous lookAt constraint when orbit stops
    } else {
      const viewer = viewerRef.current
      if (viewer && !viewer.isDestroyed()) {
        try { viewer.camera.lookAtTransform(Matrix4.IDENTITY) } catch { /* ok */ }
      }
    }
  }, [playbackOrbit, pbCameraDistance])

  // ── Post-processing mode sync ───────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setMode(activeMode)
  }, [activeMode])

  // ── Post-processing params sync ────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setParams(shaderParams)
  }, [shaderParams])

  // ── Bloom effect sync ─────────────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setBloom(bloomIntensity)
  }, [bloomIntensity])

  // ── Pixelate effect sync ──────────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setPixelate(pixelateSize)
  }, [pixelateSize])

  // ── Sharpen effect sync ───────────────────────────────────────────────────
  useEffect(() => {
    postProcessRef.current?.setSharpen(sharpenIntensity)
  }, [sharpenIntensity])

  // ── Terrain exaggeration sync ──────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.verticalExaggeration = terrainExaggeration
  }, [terrainExaggeration])

  // ── Label visibility toggle ────────────────────────────────────────────────
  useEffect(() => {
    const collections = [flightLabelsRef, milLabelsRef, vesselLabelsRef, satLabelsRef, seismicLabelsRef, fireLabelsRef, cctvLabelsRef]
    for (const ref of collections) {
      if (ref.current) ref.current.show = showLabels
    }
    viewerRef.current?.scene.requestRender()
  }, [showLabels])

  // ── Crosshair reticle — locks onto selected entity position ────────────────
  const selectedEntity = useStore((s) => s.selectedEntity)
  useEffect(() => {
    const xhair = crosshairBbRef.current
    const img = crosshairImageRef.current
    if (!xhair || !img) return

    xhair.removeAll()
    crosshairBillboardRef.current = null

    if (!selectedEntity) {
      viewerRef.current?.scene.requestRender()
      return
    }

    // Re-lookup latest data from live refs for initial position
    const { type, data: origData } = selectedEntity
    let d = origData
    if (type === 'flight') {
      const key = origData.icao24
      d = flightsRef.current.get(key) ?? milFlightsRef.current.get(key) ?? origData
    } else if (type === 'vessel') {
      d = vesselsRef.current.get(origData.mmsi) ?? origData
    } else if (type === 'satellite') {
      d = satsDataRef.current.find((s: any) => s.id === origData.id) ?? origData
    }

    let lon: number | undefined
    let lat: number | undefined
    let alt = 0

    if (type === 'flight') {
      lon = d.longitude; lat = d.latitude
      alt = d.baro_altitude ?? d.geo_altitude ?? 0
      if (alt < 0 || alt > 20_000) alt = 0
    } else if (type === 'vessel') {
      lon = d.longitude; lat = d.latitude
    } else if (type === 'satellite') {
      lon = d.longitude; lat = d.latitude
      alt = (d.altitudeKm ?? 0) * 1000
    } else {
      // seismic, wildfire, cctv, airq, weather — static position from origData
      lon = d.longitude; lat = d.latitude
    }

    if (lon == null || lat == null) return

    const pos = Cartesian3.fromDegrees(lon, lat, alt)
    const bb = xhair.add({
      position: pos,
      image: img,
      scale: 1.0,
      color: Color.fromCssColorString('#00f0ff'),
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.CENTER,
      sizeInMeters: false,
    })
    crosshairBillboardRef.current = bb

    viewerRef.current?.scene.requestRender()
  }, [selectedEntity, flights, militaryFlights, vessels, sats, seismicEvents, wildfires])

  // ── Traffic system sync ────────────────────────────────────────────────────
  useEffect(() => {
    console.debug(`[Traffic Sync] roadSegments=${roadSegments.length}, system=${!!trafficSystemRef.current}`)
    trafficSystemRef.current?.setRoadNetwork(roadSegments)
  }, [roadSegments])

  useEffect(() => {
    trafficSystemRef.current?.setDensity(trafficDensity)
  }, [trafficDensity])

  useEffect(() => {
    trafficSystemRef.current?.setMaxParticles(trafficMaxParticles)
  }, [trafficMaxParticles])

  // ── CCTV billboard + label sync (country-colored) ────────────────────────
  useEffect(() => {
    const bb = cctvBillboardsRef.current
    const cl = cctvLabelsRef.current
    const icon = cctvIconRef.current
    if (!bb || !cl || !icon) return

    const COUNTRY_COL: Record<string, Color> = {
      GB: Color.fromCssColorString('#00D4FF'),  // cyan
      US: Color.fromCssColorString('#FF9500'),  // amber
      AU: Color.fromCssColorString('#39FF14'),  // green
    }
    const DEFAULT_COL = Color.fromCssColorString('#00D4FF')

    const incoming = new Set(cctvCameras.map(c => c.id))
    const idx = cctvIndexMap.current

    // Remove stale
    for (const [id, entry] of idx) {
      if (!incoming.has(id)) {
        bb.remove(entry.billboard)
        cl.remove(entry.label)
        idx.delete(id)
      }
    }

    // Add / update
    for (const cam of cctvCameras) {
      if (cam.latitude == null || cam.longitude == null) continue
      if (!isFinite(cam.latitude) || !isFinite(cam.longitude)) continue
      if (cam.latitude < -90 || cam.latitude > 90 || cam.longitude < -180 || cam.longitude > 180) continue

      const pos = Cartesian3.fromDegrees(cam.longitude, cam.latitude, 0)
      const col = COUNTRY_COL[cam.country] ?? DEFAULT_COL
      const name = cam.name.length > 15 ? cam.name.slice(0, 15) + '\u2026' : cam.name

      if (idx.has(cam.id)) {
        // Update position only (source doesn't change)
        const entry = idx.get(cam.id)!
        entry.billboard.position = pos
        entry.label.position = pos
      } else {
        const billboard = bb.add({
          position: pos,
          image: icon,
          width: 20,
          height: 20,
          id: { type: 'cctv', key: cam.id },
          color: col,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(200, 1.0, 5e6, 0.4),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2_000_000),
        })
        const label = cl.add({
          position: pos,
          text: name,
          font: 'bold 10px "JetBrains Mono", monospace',
          fillColor: col,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(14, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 500_000),
          show: useStore.getState().showLabels,
        })
        idx.set(cam.id, { billboard, label })
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [cctvCameras])

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

    // Global view — use fallback directly, with nadir/oblique support
    if (selectedCity === 'Global') {
      if (globeViewMode === 'oblique') {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(0, 20, 25_000_000),
          orientation: { heading: CesiumMath.toRadians(10), pitch: CesiumMath.toRadians(-65), roll: 0 },
          duration: 2.5,
        })
      } else {
        const g = CITY_FALLBACKS['Global']
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(g.lon, g.lat, g.height),
          orientation: { heading: 0, pitch: CesiumMath.toRadians(g.pitch), roll: 0 },
          duration: 3,
        })
      }
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

    // If the city has landmarks, fly to landmark[0] instead of city center
    const defaultLandmark = LANDMARKS[selectedCity]?.[0]
    if (defaultLandmark) {
      flyToLandmark(viewer, defaultLandmark)
      // Set landmark in store but skip the landmark effect (we already flew)
      landmarkSkipRef.current = true
      useStore.getState().setLandmark(defaultLandmark.name)
      return
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity, citySeq, globeViewMode])

  // ── Camera: fly to selected landmark ────────────────────────────────────────
  const landmarkSkipRef = useRef(false)
  useEffect(() => {
    // Skip if this was triggered by the city-select effect setting landmark[0]
    if (landmarkSkipRef.current) {
      landmarkSkipRef.current = false
      return
    }
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed() || !selectedLandmark || !selectedCity) return
    const landmarks = LANDMARKS[selectedCity]
    if (!landmarks) return
    const lm = landmarks.find((l) => l.name === selectedLandmark)
    if (!lm) return
    flyToLandmark(viewer, lm)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLandmark])

  /** Pump render frames until 3D tiles finish loading (max 8 seconds). */
  function pumpTileLoading(viewer: Viewer) {
    const tileset = tilesetRef.current
    let frames = 0
    const maxFrames = 480 // ~8s at 60fps
    const tick = () => {
      if (viewer.isDestroyed() || frames >= maxFrames) return
      viewer.scene.requestRender()
      frames++
      // Stop early if tiles are fully loaded
      if (tileset?.tilesLoaded) return
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  /** Fly to a landmark — uses camera.flyTo with exact captured coordinates. */
  function flyToLandmark(viewer: Viewer, lm: { lat: number; lon: number; height: number; heading: number; pitch: number }) {
    // Cancel any in-progress flight first
    viewer.camera.cancelFlight()
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lm.lon, lm.lat, lm.height),
      orientation: {
        heading: CesiumMath.toRadians(lm.heading),
        pitch: CesiumMath.toRadians(lm.pitch),
        roll: 0,
      },
      duration: 1.8,
      pitchAdjustHeight: 500,  // keep arc low for close-range flights
      complete: () => pumpTileLoading(viewer),
    })
    // Also pump during the flight so tiles stream in while moving
    pumpTileLoading(viewer)
  }

  /** Fly to a geocoded city (address search / fallback coords). */
  function flyToCity(viewer: Viewer, city: { lat: number; lon: number; height: number; heading?: number; pitch: number }) {
    const hdg = city.heading ?? 0
    viewer.camera.cancelFlight()
    if (city.height <= 500) {
      const target = Cartesian3.fromDegrees(city.lon, city.lat, 0)
      viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(hdg),
          CesiumMath.toRadians(city.pitch),
          city.height
        ),
        duration: 2.5,
        complete: () => pumpTileLoading(viewer),
      })
    } else {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(city.lon, city.lat, city.height),
        orientation: {
          heading: CesiumMath.toRadians(hdg),
          pitch: CesiumMath.toRadians(city.pitch),
          roll: 0,
        },
        duration: 2.5,
        complete: () => pumpTileLoading(viewer),
      })
    }
    pumpTileLoading(viewer)
  }

  // ── Track entity: follow selected flight/satellite ─────────────────────────
  const trackInitRef = useRef<string | null>(null) // key of entity we've already flown to

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!trackedEntity) {
      trackInitRef.current = null
      // Unlock camera from any lookAt constraint (satellite tracking)
      try { viewer.camera.lookAtTransform(Matrix4.IDENTITY) } catch { /* ok */ }
      return
    }

    // When tracking a satellite, mark it for orbit path rendering
    if (trackedEntity.type === 'satellite') {
      trackSatelliteOrbit(trackedEntity.key)
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
        heading = 0           // north-up — camera stays fixed, plane moves beneath
        range = 8_000         // 8km above the plane for tight top-down view
        camPitchDeg = -90     // straight down
      }
    } else if (trackedEntity.type === 'vessel') {
      const v = vesselsRef.current.get(Number(trackedEntity.key))
      if (v && v.longitude != null && v.latitude != null) {
        lon = v.longitude
        lat = v.latitude
        alt = 0
        heading = 0           // north-up fixed camera
        range = 3_000         // 3km overhead for vessels
        camPitchDeg = -90     // straight down
      }
    } else if (trackedEntity.type === 'satellite') {
      const s = satsDataRef.current.find(s => s.id === trackedEntity.key)
      if (s) {
        lon = s.longitude
        lat = s.latitude
        alt = s.altitudeKm * 1000
        range = Math.min(alt * 0.5, 500_000)
        camPitchDeg = -55
      }
    }

    if (lon == null || lat == null) return

    const isFirstTrack = trackInitRef.current !== trackedEntity.key

    // Satellites: use rAF loop for smooth per-frame camera tracking
    // (LEO sats move ~7.5 km/s — state updates every ~3s cause drift without this)
    if (trackedEntity.type === 'satellite') {
      if (isFirstTrack) {
        trackInitRef.current = trackedEntity.key
        const target = Cartesian3.fromDegrees(lon, lat, alt)
        const hpr = new HeadingPitchRange(
          CesiumMath.toRadians(heading),
          CesiumMath.toRadians(camPitchDeg),
          range,
        )
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, alt + range),
          orientation: { heading: CesiumMath.toRadians(heading), pitch: CesiumMath.toRadians(camPitchDeg), roll: 0 },
          duration: 1.5,
          complete: () => {
            if (!viewer.isDestroyed()) {
              viewer.camera.lookAt(target, hpr)
            }
          },
        })
      }

      // Start rAF loop that reads the billboard's interpolated position every frame
      // (satsDataRef only updates on state change, but the billboard moves via interp system)
      let rafId = 0
      const trackFrame = () => {
        if (viewer.isDestroyed()) return
        const entry = satIndexMap.current.get(trackedEntity.key)
        if (entry?.billboard?.position) {
          const pos = entry.billboard.position
          // Extract altitude from Cartographic to compute range
          const carto = Cartographic.fromCartesian(pos)
          const satAlt = carto.height
          const satRange = Math.min(satAlt * 0.5, 500_000)
          const satHpr = new HeadingPitchRange(
            CesiumMath.toRadians(0),
            CesiumMath.toRadians(-55),
            satRange,
          )
          viewer.camera.lookAt(pos, satHpr)
          viewer.scene.requestRender()
        }
        rafId = requestAnimationFrame(trackFrame)
      }
      rafId = requestAnimationFrame(trackFrame)

      return () => cancelAnimationFrame(rafId)
    } else {
      // Flights/vessels: initial flyTo only — continuous tracking handled in animation loop
      const camHeading = CesiumMath.toRadians(heading)
      const camPitch = CesiumMath.toRadians(camPitchDeg)
      const camAlt = alt + range

      if (isFirstTrack) {
        trackInitRef.current = trackedEntity.key
        followPauseUntilRef.current = performance.now() + 1_600
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, camAlt),
          orientation: { heading: camHeading, pitch: camPitch, roll: 0 },
          duration: 1.5,
        })
      }
      // Continuous camera follow is in the animation loop (uses interpolated position)
    }
  }, [trackedEntity, flights, militaryFlights, vessels, sats])

  // ── Clear flight trails on playback entry ──────────────────────────────────
  useEffect(() => {
    if (playbackMode) {
      flightTrails.current.clear()
      const viewer = viewerRef.current
      if (viewer && !viewer.isDestroyed() && flightTrailPrimRef.current) {
        viewer.scene.primitives.remove(flightTrailPrimRef.current)
        flightTrailPrimRef.current = null
        viewer.scene.requestRender()
      }
    }
  }, [playbackMode])

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

    console.debug(`[Aviation Sync] ${incoming.size}/${flights.size} flights after filter`)

    const interp = interpSystemRef.current

    incoming.forEach((flight, icao) => {
      const rawAlt = flight.baro_altitude ?? flight.geo_altitude ?? 0
      const alt = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
      const pos = Cartesian3.fromDegrees(flight.longitude!, flight.latitude!, alt)
      const isEmergency = flight.squawk ? MILITARY_SQUAWKS.has(flight.squawk) : false
      const color = isEmergency ? COL_SQUAWK : getAltitudeColor(alt)
      const altScale = getAltitudeScale(alt)
      // CesiumJS billboard rotation is CCW radians from up; aircraft heading is CW from north
      const rotation = -((flight.true_track ?? 0) - PLANE_HEADING_OFFSET) * Math.PI / 180

      if (existing.has(icao)) {
        const { billboard, label } = existing.get(icao)!
        // In playback mode, set positions directly (useEntities already dead-reckons).
        // In live mode, feed interp system for smooth lerp between poll snapshots.
        if (playbackMode) {
          billboard.position = pos
          label.position = pos
        } else if (interp) {
          interp.updateTarget(`f-${icao}`, flight.longitude!, flight.latitude!, alt, billboard, label,
            flight.velocity ?? 0, flight.true_track ?? 0, 'deadreckon')
        } else {
          billboard.position = pos
          label.position = pos
        }
        billboard.color = color
        billboard.rotation = rotation
        billboard.scale = altScale
        label.text = formatFlightLabel(flight, icao)
        label.fillColor = isEmergency ? COL_SQUAWK : color
      } else {
        const entityId = { type: 'flight', key: icao }
        const billboard = fb.add({
          position: pos,
          image: planeImg,
          rotation,
          color,
          scale: altScale,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e3, 1.2, 8e6, 0.22),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = fl.add({
          position: pos,
          text: formatFlightLabel(flight, icao),
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: isEmergency ? COL_SQUAWK : color,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(12, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
          // Hide labels beyond 2,500 km — at global zoom thousands of labels
          // collide into an unreadable strip
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2.5e6),
        })
        existing.set(icao, { billboard, label })
        // Seed interp immediately so dead-reckoning (and camera tracking)
        // works from first sighting instead of the second poll
        if (!playbackMode) {
          interp?.updateTarget(`f-${icao}`, flight.longitude!, flight.latitude!, alt, billboard, label,
            flight.velocity ?? 0, flight.true_track ?? 0, 'deadreckon')
        }
      }
    })

    for (const [icao, { billboard, label }] of existing) {
      if (!incoming.has(icao)) {
        fb.remove(billboard)
        fl.remove(label)
        existing.delete(icao)
        interp?.remove(`f-${icao}`)
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
    const hideTrails = playbackMode && !showPlaybackTrails
    if (viewer && !viewer.isDestroyed()) {
      if (flightTrailPrimRef.current) {
        viewer.scene.primitives.remove(flightTrailPrimRef.current)
        flightTrailPrimRef.current = null
      }

      if (!hideTrails) {
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
    }

    viewerRef.current?.scene.requestRender()
  }, [flights, militaryFlights, aviationFilters, playbackMode, showPlaybackTrails])

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

    const interp = interpSystemRef.current

    incoming.forEach((flight, icao) => {
      const rawAlt = flight.baro_altitude ?? flight.geo_altitude ?? 0
      const alt = (rawAlt > 0 && rawAlt < 20_000) ? rawAlt : 0
      const pos = Cartesian3.fromDegrees(flight.longitude!, flight.latitude!, alt)
      const rotation = -((flight.true_track ?? 0) - PLANE_HEADING_OFFSET) * Math.PI / 180
      const altScale = getAltitudeScale(alt)

      if (existing.has(icao)) {
        const { billboard, label } = existing.get(icao)!
        if (interp) {
          interp.updateTarget(`m-${icao}`, flight.longitude!, flight.latitude!, alt, billboard, label,
            flight.velocity ?? 0, flight.true_track ?? 0, 'deadreckon')
        } else {
          billboard.position = pos
          label.position = pos
        }
        billboard.rotation = rotation
        billboard.scale = altScale
        label.text = formatFlightLabel(flight, icao)
      } else {
        const entityId = { type: 'flight', key: icao }
        const billboard = mb.add({
          position: pos,
          image: planeImg,
          rotation,
          color: COL_SQUAWK,
          scale: altScale,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(1e3, 1.2, 8e6, 0.28),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = ml.add({
          position: pos,
          text: formatFlightLabel(flight, icao),
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: COL_SQUAWK,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(12, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
          // Military labels stay visible farther out — fewer of them, higher value
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
        })
        existing.set(icao, { billboard, label })
        // Seed interp immediately — see civil flight sync
        interp?.updateTarget(`m-${icao}`, flight.longitude!, flight.latitude!, alt, billboard, label,
          flight.velocity ?? 0, flight.true_track ?? 0, 'deadreckon')
      }
    })

    for (const [icao, { billboard, label }] of existing) {
      if (!incoming.has(icao)) {
        mb.remove(billboard)
        ml.remove(label)
        existing.delete(icao)
        interp?.remove(`m-${icao}`)
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
    const interp = interpSystemRef.current

    incoming.forEach((vessel, mmsi) => {
      const pos = Cartesian3.fromDegrees(vessel.longitude, vessel.latitude, 0)
      // course (COG) is CW from north, same as aircraft true_track
      const rotation = vessel.course != null ? -(vessel.course * Math.PI / 180) : 0

      const col = vesselTypeColor(vessel.type)

      // AIS sentinels: SOG 102.3 kn = unavailable; COG 360 = unavailable.
      // Valid speed/course lets the interp system dead-reckon the vessel in
      // real time between (often minutes-apart) AIS position reports.
      const sogValid = vessel.speed != null && vessel.speed >= 0 && vessel.speed < 80
      const cogValid = vessel.course != null && vessel.course >= 0 && vessel.course < 360
      const speedMps = sogValid && cogValid ? vessel.speed * 0.514444 : 0
      const courseDeg = cogValid ? vessel.course : 0

      if (existing.has(mmsi)) {
        const { billboard, label } = existing.get(mmsi)!
        if (interp) {
          interp.updateTarget(`v-${mmsi}`, vessel.longitude, vessel.latitude, 0, billboard, label,
            speedMps, courseDeg, 'deadreckon')
        } else {
          billboard.position = pos
          label.position = pos
        }
        billboard.rotation = rotation
        billboard.color = col
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
          scaleByDistance: new NearFarScalar(1e3, 1.2, 8e6, 0.22),
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 1e7, 0.35),
        })
        const label = vl.add({
          position: pos,
          text: vessel.name || String(mmsi),
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: col,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e3, 1.0, 3e6, 0.35),
          // Hide vessel labels beyond 1,500 km — ports cluster thousands of ships
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e6),
        })
        existing.set(mmsi, { billboard, label })
        // Seed interp immediately so dead-reckoning (and camera tracking)
        // works from first sighting instead of the second AIS report
        interp?.updateTarget(`v-${mmsi}`, vessel.longitude, vessel.latitude, 0, billboard, label,
          speedMps, courseDeg, 'deadreckon')
      }
    })

    for (const [mmsi, { billboard, label }] of existing) {
      if (!incoming.has(mmsi)) {
        vp.remove(billboard)
        vl.remove(label)
        existing.delete(mmsi)
        interp?.remove(`v-${mmsi}`)
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [vessels])

  // ── Seismic sync (dots + pulse rings + labels) ──────────────────────────
  useEffect(() => {
    const sp = seismicPointsRef.current
    const spulse = seismicPulseRef.current
    const sl = seismicLabelsRef.current
    if (!sp) return

    // Full replace — seismic events list changes as a whole
    sp.removeAll()
    if (spulse) spulse.removeAll()
    if (sl) sl.removeAll()
    seismicIndexMap.current.clear()
    seismicPulseList.current = []

    const ringImg = pulseRingImageRef.current
    const now = Date.now()

    // In playback mode, only show events that have occurred by the current playback time
    const visibleEvents = playbackMode
      ? seismicEvents.filter(evt => evt.time <= playbackTime)
      : seismicEvents

    for (const evt of visibleEvents) {
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

      // Label: M{magnitude} {depth}km
      if (sl) {
        const depth = evt.depth != null ? Math.round(evt.depth) : 0
        sl.add({
          position: pos,
          text: `M${mag.toFixed(1)} ${depth}km`,
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: Color.fromCssColorString('#FFB347'),
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          translucencyByDistance: new NearFarScalar(5e5, 1.0, 2e7, 0.0),
          show: useStore.getState().showLabels,
        })
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seismicEvents, playbackMode, playbackMode && Math.floor(playbackTime / 30_000)])

  // ── Wildfire sync (billboards + labels) ──────────────────────────────────
  useEffect(() => {
    const fip = fireBillboardsRef.current
    const firLabels = fireLabelsRef.current
    if (!fip) return

    if (!fireImageRef.current) {
      fireImageRef.current = createFireImage(24)
    }
    const fireImg = fireImageRef.current

    fip.removeAll()
    if (firLabels) firLabels.removeAll()
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
        scaleByDistance: new NearFarScalar(1e4, 1.2, 2e7, 0.2),
        translucencyByDistance: new NearFarScalar(1e5, 1.0, 2e7, 0.25),
      })
      fireIndexMap.current.set(fireKey, billboard)

      // Label: FRP {frp}MW or {brightness}K
      if (firLabels) {
        const text = fire.frp > 0 ? `FRP ${Math.round(fire.frp)}MW` : `${Math.round(fire.brightness ?? 0)}K`
        firLabels.add({
          position: pos,
          text,
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: Color.fromCssColorString('#FF8C42'),
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          translucencyByDistance: new NearFarScalar(3e5, 1.0, 8e6, 0.0),
          show: useStore.getState().showLabels,
        })
      }
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
    const interp = interpSystemRef.current
    const hiddenCatalogs = useStore.getState().hiddenSatCatalogs
    const KNOWN_CATALOGS = new Set(['notable','stations','visual','weather','earth-obs','navigation','geo','sarsat','relay','comms','amateur','science','military','engineering'])

    for (const sat of sats) {
      incomingIds.add(sat.id)
      const altM = sat.altitudeKm * 1000
      const pos = Cartesian3.fromDegrees(sat.longitude, sat.latitude, altM)
      const col = orbitColor(classifyOrbit(sat.altitudeKm))
      // Hide if catalog is explicitly hidden, or if catalog is unknown and any filter is active
      const visible = KNOWN_CATALOGS.has(sat.catalog)
        ? !hiddenCatalogs.has(sat.catalog)
        : hiddenCatalogs.size === 0

      if (existing.has(sat.id)) {
        // Update position + color in-place (no GPU buffer rebuild)
        const { billboard, label } = existing.get(sat.id)!
        billboard.show = visible
        label.show = visible && showLabels
        // Feed interpolation for smooth orbital movement
        if (interp) {
          interp.updateTarget(`s-${sat.id}`, sat.longitude, sat.latitude, altM, billboard, label)
        } else {
          billboard.position = pos
          label.position = pos
        }
        billboard.color = col
        label.fillColor = col
      } else {
        const entityId = { type: 'satellite', key: sat.id }
        const billboard = satp.add({
          position: pos,
          image: satImg,
          color: col,
          show: visible,
          id: entityId,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          // Far scale kept small — 900 full-size sprites bury the globe at global
          // zoom. Far bound 2.5e7 so the shrink fully engages by global altitude.
          scaleByDistance: new NearFarScalar(1e5, 1.2, 2.5e7, 0.25),
          translucencyByDistance: new NearFarScalar(1e5, 1.0, 4e7, 0.85),
        })
        const label = satl.add({
          position: pos,
          text: sat.name || `SAT-${sat.id}`,
          show: visible && showLabels,
          font: 'bold 11px "JetBrains Mono", monospace',
          fillColor: col,
          id: entityId,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          showBackground: true,
          backgroundColor: COL_BG,
          scaleByDistance: new NearFarScalar(1e5, 1.2, 4e7, 0.6),
          translucencyByDistance: new NearFarScalar(1e5, 1.0, 4e7, 0.8),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7), // hide labels beyond 15,000km
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
        interp?.remove(`s-${id}`)
      }
    }

    viewerRef.current?.scene.requestRender()
  }, [sats, hiddenSatCatalogs])

  // ── Orbital path polylines ──────────────────────────────────────────────
  const prevSatOrbitKeyRef = useRef<string>('')
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    // Helper: remove orbit primitive
    const removeOrbitPrim = () => {
      if (satOrbitPrimRef.current) {
        try { viewer.scene.primitives.remove(satOrbitPrimRef.current) } catch { /* ok */ }
        satOrbitPrimRef.current = null
      }
    }

    // If orbits toggled off, no satellites, or trails hidden in playback — remove and bail
    if (!showSatOrbits || sats.length === 0 || (playbackMode && !showPlaybackTrails)) {
      removeOrbitPrim()
      prevSatOrbitKeyRef.current = ''
      viewer.scene.requestRender()
      return
    }

    // Build a fingerprint: visible sats that have orbit data + hidden catalogs
    const hiddenCats = useStore.getState().hiddenSatCatalogs
    const KNOWN = new Set(['notable','stations','visual','weather','earth-obs','navigation','geo','sarsat','relay','comms','amateur','science','military','engineering'])
    const visibleWithOrbits = sats.filter(s => {
      if (s.orbitSegments.length === 0) return false
      const vis = KNOWN.has(s.catalog) ? !hiddenCats.has(s.catalog) : hiddenCats.size === 0
      return vis
    })
    const hiddenKey = Array.from(hiddenCats).sort().join('|')
    const key = visibleWithOrbits.map(s => s.id).sort().join(',') + ':' + hiddenKey

    // Skip rebuild if nothing changed
    if (key === prevSatOrbitKeyRef.current) return
    prevSatOrbitKeyRef.current = key

    // Remove old and rebuild
    removeOrbitPrim()

    const orbitInstances: GeometryInstance[] = []
    for (const sat of visibleWithOrbits) {
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
        asynchronous: false,
      })
      viewer.scene.primitives.add(prim)
      satOrbitPrimRef.current = prim
    }

    viewer.scene.requestRender()
    // No cleanup return — we only remove on explicit rebuild or toggle-off
  }, [sats, playbackMode, showPlaybackTrails, hiddenSatCatalogs, showSatOrbits])

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

  // ── Satellite ground projection cone lines (curved spokes) ─────────────
  useEffect(() => {
    const viewer = viewerRef.current
    const projLines = satProjectionLinesRef.current
    if (!viewer || viewer.isDestroyed() || !projLines) return

    const prevMap = satProjectionIndexMap.current

    if (!showSatProjections || !activeLayers.includes('satellites') || sats.length === 0) {
      projLines.removeAll()
      prevMap.clear()
      viewer.scene.requestRender()
      return
    }

    const hiddenCats = useStore.getState().hiddenSatCatalogs
    const KNOWN = new Set(['notable','stations','visual','weather','earth-obs','navigation','geo','sarsat','relay','comms','amateur','science','military','engineering'])

    const Re = 6_371_000
    const SPOKES = 14
    const ARC_SEGMENTS = 16  // points per spoke for smooth curvature
    const CAP = 120

    const visibleSats = sats.filter(s => {
      return KNOWN.has(s.catalog) ? !hiddenCats.has(s.catalog) : hiddenCats.size === 0
    }).slice(0, CAP)
    const currentIds = new Set<string>()

    // Build curved arc: tight at satellite, fans out toward ground (like water from a hose)
    const buildArc = (
      satLon: number, satLat: number, h: number,
      groundLon: number, groundLat: number
    ): Cartesian3[] => {
      const pts: Cartesian3[] = []
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const t = s / ARC_SEGMENTS  // 0 = satellite, 1 = ground
        // Cubic spread: spokes stay bundled near sat, fan out toward ground
        const spread = t * t * t
        const lat = satLat + spread * (groundLat - satLat)
        const lon = satLon + spread * (groundLon - satLon)
        // Altitude drops linearly from h to 0 with a gentle outward bow
        const alt = h * (1 - t) + h * 0.08 * Math.sin(Math.PI * t)
        pts.push(Cartesian3.fromDegrees(lon, lat, Math.max(alt, 0)))
      }
      return pts
    }

    for (const sat of visibleSats) {
      currentIds.add(sat.id)
      const h = sat.altitudeKm * 1000
      const minElev = 5 * Math.PI / 180
      const centralAngle = Math.acos(Re * Math.cos(minElev) / (Re + h)) - minElev
      if (centralAngle <= 0 || isNaN(centralAngle)) continue

      const footprintRadiusDeg = centralAngle * (180 / Math.PI)
      const col = orbitColor(classifyOrbit(sat.altitudeKm))

      const existing = prevMap.get(sat.id)
      if (existing) {
        for (let i = 0; i < SPOKES; i++) {
          const angle = (2 * Math.PI * i) / SPOKES
          const groundLat = sat.latitude + footprintRadiusDeg * Math.cos(angle)
          const groundLon = sat.longitude + footprintRadiusDeg * Math.sin(angle) / Math.cos(sat.latitude * Math.PI / 180)
          if (existing[i]) existing[i].positions = buildArc(sat.longitude, sat.latitude, h, groundLon, groundLat)
        }
      } else {
        const lines: any[] = []
        for (let i = 0; i < SPOKES; i++) {
          const angle = (2 * Math.PI * i) / SPOKES
          const groundLat = sat.latitude + footprintRadiusDeg * Math.cos(angle)
          const groundLon = sat.longitude + footprintRadiusDeg * Math.sin(angle) / Math.cos(sat.latitude * Math.PI / 180)
          const line = projLines.add({
            positions: buildArc(sat.longitude, sat.latitude, h, groundLon, groundLat),
            width: 1.5,
            material: Material.fromType('PolylineGlow', {
              glowPower: 0.12,
              taperPower: 0.7,
              color: col.withAlpha(0.45),
            }),
          })
          lines.push(line)
        }
        prevMap.set(sat.id, lines)
      }
    }

    // Remove departed / filtered sats
    for (const [id, lines] of prevMap) {
      if (!currentIds.has(id)) {
        for (const l of lines) projLines.remove(l)
        prevMap.delete(id)
      }
    }

    viewer.scene.requestRender()
  }, [sats, showSatProjections, activeLayers, hiddenSatCatalogs])

  // ── Air Quality heatmap overlay ──────────────────────────────────────────
  // Ramp maps normalized AQI (0-1) → color. Each point painted as its own color.
  const AQ_RAMP: ColorRampStop[] = [
    [0.0,  0x36, 0xD9, 0x77, 140],  // good — green
    [0.33, 0xD4, 0xA0, 0x17, 170],  // moderate — amber
    [0.50, 0xD9, 0x77, 0x36, 190],  // unhealthy-sensitive — orange
    [0.67, 0xDD, 0x44, 0x44, 210],  // unhealthy — red
    [0.83, 0x99, 0x66, 0xFF, 230],  // very unhealthy — purple
    [1.0,  0x7E, 0x00, 0x23, 255],  // hazardous — maroon
  ]
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!aqHeatmapRef.current) {
      // radius 25 ≈ 4.4° lon — tight splats since stations are dense in Europe/US
      aqHeatmapRef.current = new HeatmapLayer(viewer, { radius: 25, colorRamp: AQ_RAMP, opacity: 0.55, minVisibleHeight: 150_000 })
    }

    if (airQuality.length === 0) {
      aqHeatmapRef.current.destroy()
      aqHeatmapRef.current = null
      return
    }

    // Map AQI 0-300 → 0-1 (300+ is rare, clamp to 1)
    aqHeatmapRef.current.update(
      airQuality.map(s => ({ lat: s.latitude, lon: s.longitude, value: Math.min(s.aqi / 300, 1) }))
    )

    return () => { aqHeatmapRef.current?.destroy(); aqHeatmapRef.current = null }
  }, [airQuality])

  // ── Weather radar overlay (RainViewer) ──────────────────────────────────
  // Traditional precipitation radar: global composite reflectivity tiles,
  // mosaicked + reprojected onto a classification drape (visible over the
  // photorealistic 3D tileset). Refreshes every 5 min (frames update ~10 min).
  const wantWeather = activeLayers.includes('weather')
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!wantWeather) {
      radarDrapeRef.current?.destroy()
      radarDrapeRef.current = null
      useStore.getState().setLayerError('weather', null)
      return
    }

    let cancelled = false
    const drape = new TileDrapeLayer(viewer, { opacity: 0.72 })
    radarDrapeRef.current = drape

    const { setLayerLoading, setLayerError } = useStore.getState()

    const refresh = async () => {
      if (cancelled) return
      try {
        const frame = await fetchRadarTileTemplate()
        if (cancelled) return
        if (!frame) {
          setLayerError('weather', 'Radar unavailable')
          return
        }
        const ok = await drape.loadMercator(frame.template, 3)
        if (ok && !cancelled) {
          setLayerError('weather', null)
          console.info('[Radar] Frame loaded:', new Date(frame.generated).toISOString())
        }
      } catch (err) {
        console.warn('[Radar] Refresh failed:', err)
        if (!cancelled) setLayerError('weather', 'Radar fetch failed')
      } finally {
        if (!cancelled) setLayerLoading('weather', false)
      }
    }

    setLayerLoading('weather', true)
    refresh()
    const interval = setInterval(refresh, 5 * 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
      drape.destroy()
      radarDrapeRef.current = null
    }
  }, [wantWeather])

  // ── Night Lights (NASA GIBS VIIRS Black Marble) ─────────────────────────
  // Classification drape — an ImageryLayer would be invisible under the
  // photorealistic 3D tileset. GIBS epsg4326 tiles mosaic directly.
  const wantNightLights = activeLayers.includes('nightlights')
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!wantNightLights) {
      nightLightsDrapeRef.current?.destroy()
      nightLightsDrapeRef.current = null
      return
    }

    const drape = new TileDrapeLayer(viewer, { opacity: 0.85 })
    nightLightsDrapeRef.current = drape
    // Level 3 → 16×8 tiles (4096×2048) — matches drape canvas resolution
    drape.loadGeographic(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/{z}/{y}/{x}.png',
      3,
    )

    return () => {
      drape.destroy()
      nightLightsDrapeRef.current = null
    }
  }, [wantNightLights])

  // ── GPS Jamming heatmap overlay ─────────────────────────────────────────
  // interferenceRatio 0.02-1.0 mapped to ramp. Cells already filtered (ratio ≥ 0.02).
  const GPS_RAMP: ColorRampStop[] = [
    [0.0,  0x33, 0xFF, 0x33, 120],  // green — low interference
    [0.33, 0xFF, 0xFF, 0x33, 160],  // yellow — moderate
    [0.66, 0xFF, 0x66, 0x33, 200],  // orange — high
    [1.0,  0xFF, 0x33, 0x33, 240],  // red — severe
  ]
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (!gpsJamHeatmapRef.current) {
      // radius 15 — H3 res-4 cells are small, keep splats tight
      gpsJamHeatmapRef.current = new HeatmapLayer(viewer, { radius: 15, colorRamp: GPS_RAMP, opacity: 0.6, minVisibleHeight: 100_000 })
    }

    if (gpsJam.length === 0) {
      gpsJamHeatmapRef.current.destroy()
      gpsJamHeatmapRef.current = null
      viewer.scene.requestRender()
      return
    }

    // Compute centroid; scale ratio 0.02-0.5 → 0-1 (most cells < 0.5)
    gpsJamHeatmapRef.current.update(
      gpsJam.map(cell => {
        const b = cell.boundary
        const lat = b.reduce((s, p) => s + p[0], 0) / b.length
        const lon = b.reduce((s, p) => s + p[1], 0) / b.length
        return { lat, lon, value: Math.min(cell.interferenceRatio / 0.5, 1) }
      })
    )

    return () => { gpsJamHeatmapRef.current?.destroy(); gpsJamHeatmapRef.current = null }
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

      {/* LIVE/PLAYBACK toggle — top-right of globe viewport */}
      {!cleanUI && <LivePlaybackToggle />}

      {/* Left sidebar — in dark margin */}
      {!cleanUI && <SidebarLeft viewerRef={viewerRef} />}

      {/* Right sidebar — in dark margin */}
      {!cleanUI && <SidebarRight />}

      {/* Intel feed + Satellite panel — top-right */}
      {!cleanUI && (
        <div className="absolute top-3 right-3 z-30 pointer-events-auto w-[200px] max-h-[90vh] overflow-y-auto no-scrollbar">
          <IntelFeed
            flights={flights}
            militaryFlights={militaryFlights}
            vessels={vessels}
            seismicEvents={seismicEvents}
            sats={sats}
            wildfires={wildfires}
          />
          <SatellitePanel />
        </div>
      )}

      {/* Bottom controls — swap between live and playback bars */}
      {!cleanUI && !playbackMode && <LocationsBar />}
      {!cleanUI && <StylePresetsBar />}
      {!cleanUI && playbackMode && <PlaybackBar />}

      {cleanUI && <CleanUIToggle />}
      <GpsModal onNavigate={handleGpsNavigate} />
      {trackedEntity && (
        <EntityTrackingPanel
          trackedEntity={trackedEntity}
          flightsRef={flightsRef}
          milFlightsRef={milFlightsRef}
          satsDataRef={satsDataRef}
          vesselsRef={vesselsRef}
        />
      )}
      {wantCctv && (
        <CCTVPanel
          cameras={cctvCameras}
          totalOnline={totalOnline}
          totalCameras={totalCameras}
          availableCountries={availableCountries}
          onFlyTo={(cam: CameraFeed) => {
            const v = viewerRef.current
            if (!v) return
            v.camera.flyTo({
              destination: Cartesian3.fromDegrees(cam.longitude, cam.latitude, 2000),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
              duration: 2.0,
            })
            useStore.getState().setSelectedCameraId(cam.id)
            useStore.getState().setSelectedEntity({ type: 'cctv', data: cam })
          }}
        />
      )}
    </div>
  )
}

export default App
