// @ts-ignore
import {
  PointPrimitiveCollection, Cartesian3, Color, NearFarScalar,
} from 'cesium'
import type { RoadSegment } from '../adapters/traffic'
import type { TrafficDataSampler } from '../adapters/trafficTiles'

interface SegmentMeta {
  segment: RoadSegment
  pairs: Array<{ lon1: number; lat1: number; lon2: number; lat2: number; dist: number }>
  totalLength: number
}

interface Particle {
  segIdx: number
  pairIdx: number
  t: number       // 0→1 along current pair
  speed: number   // degrees per second (approx)
  primitive: any  // CesiumJS point primitive ref
}

const SPEED_BY_CLASS: Record<string, number> = {
  motorway:  0.0008,
  trunk:     0.0006,
  primary:   0.0004,
  secondary: 0.0003,
}

const COL_GREEN  = Color.fromCssColorString('#36D977')
const COL_YELLOW = Color.fromCssColorString('#FFD700')
const COL_RED    = Color.fromCssColorString('#FF4444')

function speedColor(normalizedSpeed: number): Color {
  if (normalizedSpeed > 0.65) return COL_GREEN
  if (normalizedSpeed > 0.35) return COL_YELLOW
  return COL_RED
}

export class TrafficParticleSystem {
  private collection: PointPrimitiveCollection
  private viewer: any
  private segments: SegmentMeta[] = []
  private particles: Particle[] = []
  private density = 0.5
  private maxParticles = 800
  private totalNetworkLength = 0
  private sampler: TrafficDataSampler | null = null
  private frameCount = 0

  // Endpoint index for segment connectivity
  private endpointIndex: Map<string, number[]> = new Map()

  constructor(viewer: any) {
    this.viewer = viewer
    this.collection = new PointPrimitiveCollection()
    viewer.scene.primitives.add(this.collection)
  }

  setRoadNetwork(rawSegments: RoadSegment[]) {
    // Clear existing
    this.collection.removeAll()
    this.particles = []
    this.segments = []
    this.endpointIndex.clear()
    this.totalNetworkLength = 0

    if (!rawSegments.length) return

    // Pre-compute segment metadata
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
      this.segments.push({ segment: seg, pairs, totalLength: total })
      this.totalNetworkLength += total

      // Index endpoints for connectivity
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
      // Weighted random segment selection by length
      let r = Math.random() * this.totalNetworkLength
      let segIdx = 0
      for (let j = 0; j < this.segments.length; j++) {
        r -= this.segments[j].totalLength
        if (r <= 0) { segIdx = j; break }
      }

      const meta = this.segments[segIdx]
      const pairIdx = Math.floor(Math.random() * meta.pairs.length)
      const t = Math.random()
      const baseSpeed = SPEED_BY_CLASS[meta.segment.roadClass] ?? 0.0003
      // Add some randomness (±30%)
      const speed = baseSpeed * (0.7 + Math.random() * 0.6)

      const pair = meta.pairs[pairIdx]
      const lon = pair.lon1 + (pair.lon2 - pair.lon1) * t
      const lat = pair.lat1 + (pair.lat2 - pair.lat1) * t

      const primitive = this.collection.add({
        position: Cartesian3.fromDegrees(lon, lat, 5),
        pixelSize: 3,
        color: speedColor(speed / 0.0008),
        scaleByDistance: new NearFarScalar(500, 1.5, 5e5, 0.3),
        translucencyByDistance: new NearFarScalar(1e3, 1.0, 3e5, 0.0),
      })

      this.particles.push({ segIdx, pairIdx, t, speed, primitive })
    }
  }

  update(dt: number) {
    if (!this.particles.length) return
    let needsRender = false
    this.frameCount++

    // Re-sample traffic levels every ~30 frames (~0.5s at 60fps)
    const shouldSample = this.sampler && (this.frameCount % 30 === 0)

    for (const p of this.particles) {
      const meta = this.segments[p.segIdx]
      if (!meta) continue

      const pair = meta.pairs[p.pairIdx]
      if (!pair || pair.dist < 1e-8) {
        // Skip degenerate segments
        p.pairIdx = (p.pairIdx + 1) % meta.pairs.length
        p.t = 0
        continue
      }

      // Advance position
      p.t += (p.speed * dt) / pair.dist

      if (p.t >= 1) {
        // Move to next pair in segment
        p.pairIdx++
        p.t = 0

        if (p.pairIdx >= meta.pairs.length) {
          // Segment end — try to find connected segment
          const lastCoord = meta.segment.coordinates[meta.segment.coordinates.length - 1]
          const endKey = `${lastCoord[0].toFixed(4)},${lastCoord[1].toFixed(4)}`
          const connected = this.endpointIndex.get(endKey)

          if (connected && connected.length > 1) {
            // Pick a random connected segment (not the current one)
            const candidates = connected.filter(idx => idx !== p.segIdx)
            if (candidates.length > 0) {
              const nextIdx = candidates[Math.floor(Math.random() * candidates.length)]
              const nextMeta = this.segments[nextIdx]
              // Check if we should start from beginning or end of the new segment
              const nextFirst = nextMeta.segment.coordinates[0]
              const startKey = `${nextFirst[0].toFixed(4)},${nextFirst[1].toFixed(4)}`
              p.segIdx = nextIdx
              if (startKey === endKey) {
                p.pairIdx = 0
              } else {
                p.pairIdx = nextMeta.pairs.length - 1
              }
              p.t = 0
            } else {
              this.respawnParticle(p)
            }
          } else {
            this.respawnParticle(p)
          }
          continue
        }
      }

      // Interpolate position after advance
      const cp = meta.pairs[p.pairIdx]
      if (!cp) continue
      const lon = cp.lon1 + (cp.lon2 - cp.lon1) * p.t
      const lat = cp.lat1 + (cp.lat2 - cp.lat1) * p.t

      // Sample real traffic data to update speed + color
      if (shouldSample) {
        const level = this.sampler!.sampleTrafficLevel(lat, lon)
        if (level !== null) {
          p.speed = 0.0001 + level * 0.0007
          p.primitive.color = speedColor(level)
        }
      }

      p.primitive.position = Cartesian3.fromDegrees(lon, lat, 5)
      needsRender = true
    }

    if (needsRender) this.viewer.scene.requestRender()
  }

  private respawnParticle(p: Particle) {
    // Random respawn on network
    let r = Math.random() * this.totalNetworkLength
    for (let j = 0; j < this.segments.length; j++) {
      r -= this.segments[j].totalLength
      if (r <= 0) { p.segIdx = j; break }
    }
    p.pairIdx = Math.floor(Math.random() * this.segments[p.segIdx].pairs.length)
    p.t = 0
  }

  destroy() {
    this.viewer.scene.primitives.remove(this.collection)
    this.particles = []
    this.segments = []
  }
}
