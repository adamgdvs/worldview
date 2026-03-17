// @ts-ignore
import {
  Cartesian3, HeadingPitchRange, Math as CesiumMath,
  type Viewer,
} from 'cesium'
import type { CameraPreset } from '../store'

/**
 * Camera orbit system: rotates the camera around a look-at target.
 * FLAT: constant heading rotation
 * SPIRAL_IN: rotate + decrease distance
 * SPIRAL_OUT: rotate + increase distance
 */
export class CameraOrbitSystem {
  private heading = 0  // radians, accumulates
  private elapsed = 0

  reset(_distanceKm?: number) {
    this.heading = 0
    this.elapsed = 0
  }

  tick(
    dt: number,
    viewer: Viewer,
    preset: CameraPreset,
    distanceKm: number,
    pitchDeg: number,
    _fovDeg: number,
    lookAtLon: number,
    lookAtLat: number,
  ) {
    if (viewer.isDestroyed()) return

    const rotationSpeed = CesiumMath.toRadians(3) // 3°/s
    this.heading += rotationSpeed * dt
    this.elapsed += dt

    let distance = distanceKm * 1000 // metres

    if (preset === 'SPIRAL_IN') {
      // Decrease distance over 60s to 30% of original
      const factor = Math.max(0.3, 1 - (this.elapsed / 60) * 0.7)
      distance *= factor
    } else if (preset === 'SPIRAL_OUT') {
      // Increase distance over 60s to 300% of original
      const factor = Math.min(3, 1 + (this.elapsed / 60) * 2)
      distance *= factor
    }

    const target = Cartesian3.fromDegrees(lookAtLon, lookAtLat, 0)
    const hpr = new HeadingPitchRange(
      this.heading,
      CesiumMath.toRadians(pitchDeg),
      distance,
    )

    viewer.camera.lookAt(target, hpr)
    viewer.scene.requestRender()
  }
}
