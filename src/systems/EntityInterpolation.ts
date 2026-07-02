/**
 * Entity interpolation system: smoothly lerps billboard/label positions
 * between data snapshots. Supports two modes:
 *  - 'lerp': smoothstep between prev→target (satellites, vessels)
 *  - 'deadreckon': lerp to target, then extrapolate using velocity+heading (flights)
 */
// @ts-ignore
import { Cartesian3 } from 'cesium'

type InterpMode = 'lerp' | 'deadreckon'

interface InterpEntry {
  prevLon: number
  prevLat: number
  prevAlt: number
  targetLon: number
  targetLat: number
  targetAlt: number
  progress: number       // 0→1, advances each frame
  billboard: any         // CesiumJS Billboard reference
  label: any | null      // CesiumJS Label reference (optional)
  // Dead-reckoning fields
  mode: InterpMode
  velocityMps: number    // ground speed in m/s
  headingDeg: number     // true track in degrees
  lastUpdateTime: number // performance.now() when target was last set
  // Current extrapolated position (used when dead-reckoning past target)
  extraLon: number
  extraLat: number
  extraAlt: number
  extrapolating: boolean // true when progress >= 1 and mode is deadreckon
}

const DEG_TO_RAD = Math.PI / 180
// Cap extrapolation at 10 min past last update. Long enough that entities keep
// moving in real time through poll failures / rate limiting; position corrects
// on the next successful data refresh.
const MAX_EXTRAP_SEC = 600

export class EntityInterpolationSystem {
  private entries = new Map<string, InterpEntry>()
  private interpDuration = 3.0 // seconds to interpolate over

  /**
   * Called when new entity data arrives (e.g., from a poll or playback update).
   * Records previous position and sets new target.
   */
  updateTarget(
    key: string,
    lon: number, lat: number, alt: number,
    billboard: any,
    label: any | null,
    velocity?: number,
    heading?: number,
    mode?: InterpMode,
  ) {
    const now = performance.now() / 1000
    const existing = this.entries.get(key)
    if (existing) {
      // Current position becomes the new "prev" — use extrapolated pos if dead-reckoning
      let curLon: number, curLat: number, curAlt: number
      if (existing.extrapolating) {
        curLon = existing.extraLon
        curLat = existing.extraLat
        curAlt = existing.extraAlt
      } else {
        const t = Math.min(existing.progress, 1)
        const s = t * t * (3 - 2 * t) // smoothstep
        curLon = existing.prevLon + (existing.targetLon - existing.prevLon) * s
        curLat = existing.prevLat + (existing.targetLat - existing.prevLat) * s
        curAlt = existing.prevAlt + (existing.targetAlt - existing.prevAlt) * s
      }

      existing.prevLon = curLon
      existing.prevLat = curLat
      existing.prevAlt = curAlt
      existing.targetLon = lon
      existing.targetLat = lat
      existing.targetAlt = alt
      existing.progress = 0
      existing.extrapolating = false
      existing.billboard = billboard
      existing.label = label
      existing.lastUpdateTime = now
      if (velocity !== undefined) existing.velocityMps = velocity
      if (heading !== undefined) existing.headingDeg = heading
      if (mode !== undefined) existing.mode = mode
    } else {
      // First time seeing this entity — no interpolation needed, start at target
      const useDeadreckon = (mode ?? 'lerp') === 'deadreckon'
      this.entries.set(key, {
        prevLon: lon, prevLat: lat, prevAlt: alt,
        targetLon: lon, targetLat: lat, targetAlt: alt,
        progress: 1, // already at target
        billboard, label,
        mode: mode ?? 'lerp',
        velocityMps: velocity ?? 0,
        headingDeg: heading ?? 0,
        lastUpdateTime: now,
        extraLon: lon,
        extraLat: lat,
        extraAlt: alt,
        extrapolating: useDeadreckon,  // start dead-reckoning immediately for flights
      })
    }
  }

  /**
   * Called every animation frame. Advances interpolation and updates positions.
   * Returns true if any positions were updated (scene needs render).
   */
  tick(dt: number): boolean {
    if (this.entries.size === 0) return false

    let needsRender = false
    const step = dt / this.interpDuration
    const now = performance.now() / 1000

    for (const entry of this.entries.values()) {
      let lon: number, lat: number, alt: number

      if (entry.progress < 1) {
        // Phase 1: lerp/smoothstep from prev to target
        entry.progress = Math.min(entry.progress + step, 1)
        const t = entry.progress
        const s = t * t * (3 - 2 * t) // smoothstep easing

        lon = entry.prevLon + (entry.targetLon - entry.prevLon) * s
        lat = entry.prevLat + (entry.targetLat - entry.prevLat) * s
        alt = entry.prevAlt + (entry.targetAlt - entry.prevAlt) * s

        // Store for dead-reckoning handoff
        entry.extraLon = lon
        entry.extraLat = lat
        entry.extraAlt = alt

        if (entry.progress >= 1 && entry.mode === 'deadreckon') {
          entry.extrapolating = true
        }

        needsRender = true
      } else if (entry.mode === 'deadreckon' && entry.extrapolating && entry.velocityMps > 0) {
        // Phase 2: dead-reckon past target using velocity + heading
        const elapsed = now - entry.lastUpdateTime
        if (elapsed > MAX_EXTRAP_SEC) continue // cap — don't drift forever

        const hdgRad = entry.headingDeg * DEG_TO_RAD
        const dist = entry.velocityMps * dt // meters this frame

        // Approximate lat/lon displacement
        const dLat = Math.cos(hdgRad) * dist / 111320
        const dLon = Math.sin(hdgRad) * dist / (111320 * Math.cos(entry.extraLat * DEG_TO_RAD))

        entry.extraLon += dLon
        entry.extraLat += dLat
        // alt stays at target (no vertical extrapolation)

        lon = entry.extraLon
        lat = entry.extraLat
        alt = entry.extraAlt

        needsRender = true
      } else {
        continue // lerp mode, already at target — nothing to do
      }

      const pos = Cartesian3.fromDegrees(lon, lat, alt)

      if (entry.billboard && !entry.billboard.isDestroyed?.()) {
        entry.billboard.position = pos
      }
      if (entry.label && !entry.label.isDestroyed?.()) {
        entry.label.position = pos
      }
    }

    return needsRender
  }

  /**
   * Get the current interpolated/extrapolated position for an entity.
   * Returns null if entity is not tracked.
   */
  getPosition(key: string): { lon: number; lat: number; alt: number } | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.extrapolating) {
      return { lon: entry.extraLon, lat: entry.extraLat, alt: entry.extraAlt }
    }
    const t = Math.min(entry.progress, 1)
    const s = t * t * (3 - 2 * t)
    return {
      lon: entry.prevLon + (entry.targetLon - entry.prevLon) * s,
      lat: entry.prevLat + (entry.targetLat - entry.prevLat) * s,
      alt: entry.prevAlt + (entry.targetAlt - entry.prevAlt) * s,
    }
  }

  /**
   * Remove an entity from interpolation tracking.
   */
  remove(key: string) {
    this.entries.delete(key)
  }

  /**
   * Clear all tracking.
   */
  clear() {
    this.entries.clear()
  }

  /**
   * Set the interpolation duration in seconds.
   */
  setDuration(seconds: number) {
    this.interpDuration = seconds
  }

  get size() {
    return this.entries.size
  }
}
