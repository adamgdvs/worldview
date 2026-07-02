// @ts-ignore
import {
  BillboardCollection, Cartesian3, Color, NearFarScalar,
  HorizontalOrigin, VerticalOrigin,
} from 'cesium'
import type { RoadSegment } from '../adapters/traffic'
import type { TrafficDataSampler } from '../adapters/trafficTiles'

interface SegmentMeta {
  segment: RoadSegment
  pairs: Array<{ lon1: number; lat1: number; lon2: number; lat2: number; dist: number }>
  totalLength: number
  endIntersection: boolean
  startIntersection: boolean
}

interface Particle {
  segIdx: number
  pairIdx: number
  t: number       // 0→1 along current pair
  speed: number   // degrees per second (approx)
  baseSpeed: number
  billboard: any  // CesiumJS billboard ref
  stopped: number // time remaining stopped (seconds), 0 = moving
}

// Traffic light cycle
const GREEN_DURATION = 8
const RED_DURATION = 6
const CYCLE_DURATION = GREEN_DURATION + RED_DURATION
const BRAKE_ZONE = 0.7

// Faster speeds for smoother visible movement
const SPEED_BY_CLASS: Record<string, number> = {
  motorway:  0.0012,
  trunk:     0.0009,
  primary:   0.0006,
  secondary: 0.0004,
}

// Semi-transparent speed colors
const COL_GREEN  = new Color(0.21, 0.85, 0.47, 0.7)  // #36D977 @ 70%
const COL_YELLOW = new Color(1.0, 0.84, 0.0, 0.7)    // #FFD700 @ 70%
const COL_RED    = new Color(1.0, 0.27, 0.27, 0.7)    // #FF4444 @ 70%

function speedColor(normalizedSpeed: number): Color {
  if (normalizedSpeed > 0.65) return COL_GREEN
  if (normalizedSpeed > 0.35) return COL_YELLOW
  return COL_RED
}

/** Create a small square image data URL for vehicle billboards */
function createSquareIcon(size = 6): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  return canvas.toDataURL()
}

export class TrafficParticleSystem {
  private collection: BillboardCollection
  private viewer: any
  private segments: SegmentMeta[] = []
  private particles: Particle[] = []
  private density = 0.5
  private maxParticles = 800
  private totalNetworkLength = 0
  private sampler: TrafficDataSampler | null = null
  private frameCount = 0
  private squareIcon: string
  private currentSegmentIds: Set<string> = new Set()

  // Endpoint index for segment connectivity
  private endpointIndex: Map<string, number[]> = new Map()
  // Intersection phase offsets
  private intersectionPhase: Map<string, number> = new Map()

  constructor(viewer: any) {
    this.viewer = viewer
    this.collection = new BillboardCollection()
    viewer.scene.primitives.add(this.collection)
    this.squareIcon = createSquareIcon(6)
  }

  setRoadNetwork(rawSegments: RoadSegment[]) {
    // Skip rebuild if the road network hasn't changed
    const newIds = new Set(rawSegments.map(s => s.id))
    if (newIds.size === this.currentSegmentIds.size && rawSegments.length > 0) {
      let same = true
      for (const id of newIds) {
        if (!this.currentSegmentIds.has(id)) { same = false; break }
      }
      if (same) return // identical road network — keep particles running
    }
    this.currentSegmentIds = newIds

    this.collection.removeAll()
    this.particles = []
    this.segments = []
    this.endpointIndex.clear()
    this.intersectionPhase.clear()
    this.totalNetworkLength = 0

    if (!rawSegments.length) return

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i]
      const pairs: SegmentMeta['pairs'] = []
      let total = 0
      for (let j = 0; j < seg.coordinates.length - 1; j++) {
        const [lon1, lat1] = seg.coordinates[j]
        const [lon2, lat2] = seg.coordinates[j + 1]
        const dlat = lat2 - lat1
        const dlon = lon2 - lon1
        const dist = Math.sqrt(dlat * dlat + dlon * dlon)
        pairs.push({ lon1, lat1, lon2, lat2, dist })
        total += dist
      }
      if (pairs.length === 0) continue
      this.segments.push({ segment: seg, pairs, totalLength: total, endIntersection: false, startIntersection: false })
      this.totalNetworkLength += total

      const sIdx = this.segments.length - 1
      const firstCoord = seg.coordinates[0]
      const lastCoord = seg.coordinates[seg.coordinates.length - 1]
      const startKey = `${firstCoord[0].toFixed(4)},${firstCoord[1].toFixed(4)}`
      const endKey = `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`

      if (!this.endpointIndex.has(startKey)) this.endpointIndex.set(startKey, [])
      this.endpointIndex.get(startKey)!.push(sIdx)
      if (!this.endpointIndex.has(endKey)) this.endpointIndex.set(endKey, [])
      this.endpointIndex.get(endKey)!.push(sIdx)
    }

    // Identify intersections (3+ segments meet)
    for (const [key, segIndices] of this.endpointIndex) {
      if (segIndices.length >= 3) {
        this.intersectionPhase.set(key, Math.random() * CYCLE_DURATION)
        for (const sIdx of segIndices) {
          const seg = this.segments[sIdx]
          const firstCoord = seg.segment.coordinates[0]
          const lastCoord = seg.segment.coordinates[seg.segment.coordinates.length - 1]
          const sk = `${firstCoord[0].toFixed(4)},${firstCoord[1].toFixed(4)}`
          const ek = `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`
          if (ek === key) seg.endIntersection = true
          if (sk === key) seg.startIntersection = true
        }
      }
    }

    // 2-way junctions on minor roads = stop signs
    for (const [key, segIndices] of this.endpointIndex) {
      if (segIndices.length === 2 && !this.intersectionPhase.has(key)) {
        const hasMinor = segIndices.some(i => {
          const rc = this.segments[i].segment.roadClass
          return rc === 'secondary' || rc === 'primary'
        })
        if (hasMinor) {
          this.intersectionPhase.set(key, Math.random() * CYCLE_DURATION)
          for (const sIdx of segIndices) {
            const seg = this.segments[sIdx]
            const lastCoord = seg.segment.coordinates[seg.segment.coordinates.length - 1]
            const ek = `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`
            if (ek === key) seg.endIntersection = true
          }
        }
      }
    }

    this.spawnParticles()
  }

  setDensity(d: number) {
    this.density = Math.max(0, Math.min(1, d))
    this.respawn()
  }

  setMaxParticles(n: number) {
    this.maxParticles = Math.max(0, Math.min(2000, n))
    this.respawn()
  }

  setSampler(sampler: TrafficDataSampler) {
    this.sampler = sampler
  }

  private respawn() {
    this.collection.removeAll()
    this.particles = []
    this.spawnParticles()
  }

  private spawnParticles() {
    if (!this.segments.length) return

    const count = Math.round(this.maxParticles * this.density)

    for (let i = 0; i < count; i++) {
      let r = Math.random() * this.totalNetworkLength
      let segIdx = 0
      for (let j = 0; j < this.segments.length; j++) {
        r -= this.segments[j].totalLength
        if (r <= 0) { segIdx = j; break }
      }

      const meta = this.segments[segIdx]
      const pairIdx = Math.floor(Math.random() * meta.pairs.length)
      const t = Math.random()
      const baseSpeed = SPEED_BY_CLASS[meta.segment.roadClass] ?? 0.0004
      const speed = baseSpeed * (0.7 + Math.random() * 0.6)

      const pair = meta.pairs[pairIdx]
      const lon = pair.lon1 + (pair.lon2 - pair.lon1) * t
      const lat = pair.lat1 + (pair.lat2 - pair.lat1) * t

      const billboard = this.collection.add({
        position: Cartesian3.fromDegrees(lon, lat, 5),
        image: this.squareIcon,
        width: 5,
        height: 5,
        color: speedColor(speed / 0.0012),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(500, 1.8, 5e5, 0.4),
        translucencyByDistance: new NearFarScalar(500, 1.0, 3e5, 0.0),
        // Photorealistic 3D tiles have real elevation — OSM coords at 5m sit
        // inside the tile geometry and fail the depth test. Draw on top.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })

      this.particles.push({ segIdx, pairIdx, t, speed, baseSpeed: speed, billboard, stopped: 0 })
    }
  }

  private isRedLight(intersectionKey: string, now: number): boolean {
    const phase = this.intersectionPhase.get(intersectionKey)
    if (phase == null) return false
    const cycleTime = (now + phase) % CYCLE_DURATION
    return cycleTime >= GREEN_DURATION
  }

  private getEndKey(meta: SegmentMeta): string {
    const lastCoord = meta.segment.coordinates[meta.segment.coordinates.length - 1]
    return `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`
  }

  update(dt: number) {
    if (!this.particles.length) return
    let needsRender = false
    this.frameCount++

    const now = performance.now() / 1000

    const shouldSample = this.sampler && (this.frameCount % 30 === 0)

    for (const p of this.particles) {
      const meta = this.segments[p.segIdx]
      if (!meta) continue

      // Handle stopped particles
      if (p.stopped > 0) {
        p.stopped -= dt
        if (p.stopped > 0) {
          p.billboard.color = COL_RED
          continue
        }
        p.stopped = 0
        p.speed = p.baseSpeed
      }

      const pair = meta.pairs[p.pairIdx]
      if (!pair || pair.dist < 1e-8) {
        p.pairIdx = (p.pairIdx + 1) % meta.pairs.length
        p.t = 0
        continue
      }

      // Braking at intersections
      const isLastPair = p.pairIdx === meta.pairs.length - 1
      if (isLastPair && meta.endIntersection && p.t > BRAKE_ZONE) {
        const endKey = this.getEndKey(meta)
        if (this.isRedLight(endKey, now)) {
          const brakeFactor = 1.0 - ((p.t - BRAKE_ZONE) / (1.0 - BRAKE_ZONE))
          p.speed = p.baseSpeed * Math.max(0.05, brakeFactor)
          if (p.t > 0.95) {
            p.speed = 0
            p.stopped = 0.1
            p.billboard.color = COL_RED
            continue
          }
        } else {
          p.speed = p.baseSpeed
        }
      }

      // Advance
      p.t += (p.speed * dt) / pair.dist

      if (p.t >= 1) {
        p.pairIdx++
        p.t = 0

        if (p.pairIdx >= meta.pairs.length) {
          if (meta.endIntersection) {
            const endKey = this.getEndKey(meta)
            if (this.isRedLight(endKey, now)) {
              const phase = this.intersectionPhase.get(endKey) ?? 0
              const cycleTime = (now + phase) % CYCLE_DURATION
              const remaining = CYCLE_DURATION - cycleTime
              p.stopped = remaining + Math.random() * 0.5
              p.pairIdx = meta.pairs.length - 1
              p.t = 0.98
              p.billboard.color = COL_RED
              continue
            }
          }

          // Try connected segment
          const lastCoord = meta.segment.coordinates[meta.segment.coordinates.length - 1]
          const endKey = `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`
          const connected = this.endpointIndex.get(endKey)

          if (connected && connected.length > 1) {
            const candidates = connected.filter(idx => idx !== p.segIdx)
            if (candidates.length > 0) {
              const nextIdx = candidates[Math.floor(Math.random() * candidates.length)]
              const nextMeta = this.segments[nextIdx]
              const nextFirst = nextMeta.segment.coordinates[0]
              const startKey = `${nextFirst[0].toFixed(4)},${nextFirst[1].toFixed(4)}`
              p.segIdx = nextIdx
              if (startKey === endKey) {
                p.pairIdx = 0
              } else {
                p.pairIdx = nextMeta.pairs.length - 1
              }
              p.t = 0
              const newBaseSpeed = SPEED_BY_CLASS[nextMeta.segment.roadClass] ?? 0.0004
              p.baseSpeed = newBaseSpeed * (0.7 + Math.random() * 0.6)
              p.speed = p.baseSpeed
            } else {
              this.respawnParticle(p)
            }
          } else {
            this.respawnParticle(p)
          }
          continue
        }
      }

      // Interpolate position
      const cp = meta.pairs[p.pairIdx]
      if (!cp) continue
      const lon = cp.lon1 + (cp.lon2 - cp.lon1) * p.t
      const lat = cp.lat1 + (cp.lat2 - cp.lat1) * p.t

      // Sample real traffic data
      if (shouldSample && p.stopped <= 0) {
        const level = this.sampler!.sampleTrafficLevel(lat, lon)
        if (level !== null) {
          p.baseSpeed = 0.0002 + level * 0.001
          p.speed = p.baseSpeed
          p.billboard.color = speedColor(level)
        }
      } else if (p.stopped <= 0) {
        p.billboard.color = speedColor(p.speed / 0.0012)
      }

      p.billboard.position = Cartesian3.fromDegrees(lon, lat, 5)
      needsRender = true
    }

    if (needsRender && !this.viewer.isDestroyed()) this.viewer.scene.requestRender()
  }

  private respawnParticle(p: Particle) {
    let r = Math.random() * this.totalNetworkLength
    for (let j = 0; j < this.segments.length; j++) {
      r -= this.segments[j].totalLength
      if (r <= 0) { p.segIdx = j; break }
    }
    p.pairIdx = Math.floor(Math.random() * this.segments[p.segIdx].pairs.length)
    p.t = 0
    p.stopped = 0
    const meta = this.segments[p.segIdx]
    const newBaseSpeed = SPEED_BY_CLASS[meta.segment.roadClass] ?? 0.0004
    p.baseSpeed = newBaseSpeed * (0.7 + Math.random() * 0.6)
    p.speed = p.baseSpeed
  }

  destroy() {
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection)
    }
    this.particles = []
    this.segments = []
  }
}
