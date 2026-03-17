/**
 * Entity interpolation system: smoothly lerps billboard/label positions
 * between data snapshots. Works by storing previous + current positions
 * and interpolating in the animation loop.
 *
 * Each entity has: prevPos, targetPos, interpProgress (0→1)
 */
// @ts-ignore
import { Cartesian3 } from 'cesium'

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
}

export class EntityInterpolationSystem {
  private entries = new Map<string, InterpEntry>()
  private interpDuration = 3.0 // seconds to interpolate over (matches poll interval feel)

  /**
   * Called when new entity data arrives (e.g., from a poll or playback update).
   * Records previous position and sets new target.
   */
  updateTarget(
    key: string,
    lon: number, lat: number, alt: number,
    billboard: any,
    label: any | null,
  ) {
    const existing = this.entries.get(key)
    if (existing) {
      // Current interpolated position becomes the new "prev"
      const t = Math.min(existing.progress, 1)
      const curLon = existing.prevLon + (existing.targetLon - existing.prevLon) * t
      const curLat = existing.prevLat + (existing.targetLat - existing.prevLat) * t
      const curAlt = existing.prevAlt + (existing.targetAlt - existing.prevAlt) * t

      existing.prevLon = curLon
      existing.prevLat = curLat
      existing.prevAlt = curAlt
      existing.targetLon = lon
      existing.targetLat = lat
      existing.targetAlt = alt
      existing.progress = 0
      existing.billboard = billboard
      existing.label = label
    } else {
      // First time seeing this entity — no interpolation needed
      this.entries.set(key, {
        prevLon: lon, prevLat: lat, prevAlt: alt,
        targetLon: lon, targetLat: lat, targetAlt: alt,
        progress: 1, // already at target
        billboard, label,
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

    for (const entry of this.entries.values()) {
      if (entry.progress >= 1) continue

      entry.progress = Math.min(entry.progress + step, 1)
      const t = entry.progress

      // Smooth step easing
      const s = t * t * (3 - 2 * t)

      const lon = entry.prevLon + (entry.targetLon - entry.prevLon) * s
      const lat = entry.prevLat + (entry.targetLat - entry.prevLat) * s
      const alt = entry.prevAlt + (entry.targetAlt - entry.prevAlt) * s

      const pos = Cartesian3.fromDegrees(lon, lat, alt)

      if (entry.billboard && !entry.billboard.isDestroyed?.()) {
        entry.billboard.position = pos
      }
      if (entry.label && !entry.label.isDestroyed?.()) {
        entry.label.position = pos
      }

      needsRender = true
    }

    return needsRender
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
