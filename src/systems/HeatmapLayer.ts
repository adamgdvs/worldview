// @ts-ignore
import {
  Viewer, Entity, Rectangle, ClassificationType, ImageMaterialProperty,
} from 'cesium'

export interface HeatmapPoint {
  lat: number
  lon: number
  value: number // 0-1 normalized
}

/** [threshold 0-1, r, g, b, a 0-255] */
export type ColorRampStop = [number, number, number, number, number]

export interface HeatmapOptions {
  radius: number       // Gaussian splat radius in canvas pixels (2048×1024)
  colorRamp: ColorRampStop[]
  opacity: number      // overall layer opacity baked into alpha
  /**
   * Hide the layer when the camera is below this altitude (metres).
   * The 2048×1024 whole-globe canvas is ~20 km/pixel — at city zoom it
   * degrades into a structureless color wash, so fade it out.
   */
  minVisibleHeight?: number
}

const CANVAS_W = 2048
const CANVAS_H = 1024

/**
 * Look up color from a sorted ramp for a given 0-1 value.
 */
function sampleRamp(ramp: ColorRampStop[], t: number): [number, number, number, number] {
  if (t <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3], ramp[0][4]]
  const last = ramp[ramp.length - 1]
  if (t >= last[0]) return [last[1], last[2], last[3], last[4]]

  for (let j = 0; j < ramp.length - 1; j++) {
    if (t >= ramp[j][0] && t <= ramp[j + 1][0]) {
      const lo = ramp[j], hi = ramp[j + 1]
      const range = hi[0] - lo[0]
      const f = range > 0 ? (t - lo[0]) / range : 0
      return [
        Math.round(lo[1] + (hi[1] - lo[1]) * f),
        Math.round(lo[2] + (hi[2] - lo[2]) * f),
        Math.round(lo[3] + (hi[3] - lo[3]) * f),
        Math.round(lo[4] + (hi[4] - lo[4]) * f),
      ]
    }
  }
  return [last[1], last[2], last[3], last[4]]
}

/**
 * Renders data as a smooth heatmap draped on the Cesium globe via
 * an offscreen canvas → Entity RectangleGraphics with classificationType: BOTH.
 * Drapes perfectly onto Google Photorealistic 3D Tiles at all zoom levels.
 *
 * Each point is painted as a colored radial gradient based on its value.
 * This produces correct value-based coloring without density distortion.
 */
export class HeatmapLayer {
  private viewer: Viewer
  // Double-buffered: draw into the back canvas, then hand it to Cesium.
  // Alternating canvas objects forces a texture re-upload without the
  // main-thread PNG encode that toDataURL() would cost (~100ms at 2048×1024).
  private canvases: [HTMLCanvasElement, HTMLCanvasElement]
  private backIndex = 0
  private entity: Entity | null = null
  private options: HeatmapOptions
  private cameraListener: (() => void) | null = null

  constructor(viewer: Viewer, options: HeatmapOptions) {
    this.viewer = viewer
    this.options = options
    const mkCanvas = () => {
      const c = document.createElement('canvas')
      c.width = CANVAS_W
      c.height = CANVAS_H
      return c
    }
    this.canvases = [mkCanvas(), mkCanvas()]

    if (options.minVisibleHeight) {
      this.cameraListener = () => this.applyHeightVisibility()
      this.viewer.camera.changed.addEventListener(this.cameraListener)
    }
  }

  private applyHeightVisibility() {
    if (!this.entity || !this.options.minVisibleHeight) return
    const height = this.viewer.camera.positionCartographic.height
    const show = height >= this.options.minVisibleHeight
    if (this.entity.show !== show) {
      this.entity.show = show
      this.viewer.scene.requestRender()
    }
  }

  /** Re-render the heatmap with new data points. */
  update(points: HeatmapPoint[]) {
    const { options } = this
    const { radius, colorRamp, opacity } = options
    const ramp = [...colorRamp].sort((a, b) => a[0] - b[0])

    const canvas = this.canvases[this.backIndex]
    this.backIndex = 1 - this.backIndex
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

    // Sort points by value ascending so higher-value points paint on top
    const sorted = [...points].sort((a, b) => a.value - b.value)

    ctx.globalCompositeOperation = 'source-over'
    for (const pt of sorted) {
      const x = ((pt.lon + 180) / 360) * CANVAS_W
      const y = ((90 - pt.lat) / 180) * CANVAS_H
      const v = Math.max(0, Math.min(1, pt.value))

      const [r, g, b, a] = sampleRamp(ramp, v)
      const alpha = (a / 255) * opacity

      if (alpha < 0.01) continue  // skip invisible

      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`)
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.5})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)

      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    // ── Create / update entity — hand the canvas straight to Cesium ──────
    if (this.entity) {
      const mat = this.entity.rectangle!.material as ImageMaterialProperty
      // @ts-expect-error — ImageMaterialProperty.image accepts raw values at runtime
      mat.image = canvas
    } else {
      this.entity = this.viewer.entities.add({
        rectangle: {
          coordinates: Rectangle.fromDegrees(-180, -90, 180, 90),
          material: new ImageMaterialProperty({ image: canvas, transparent: true }),
          classificationType: ClassificationType.BOTH,
        },
      })
    }

    this.applyHeightVisibility()
    this.viewer.scene.requestRender()
  }

  destroy() {
    if (this.cameraListener) {
      this.viewer.camera.changed.removeEventListener(this.cameraListener)
      this.cameraListener = null
    }
    if (this.entity) {
      this.viewer.entities.remove(this.entity)
      this.entity = null
      this.viewer.scene.requestRender()
    }
  }
}
