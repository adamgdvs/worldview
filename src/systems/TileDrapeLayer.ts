// @ts-ignore
import {
  Viewer, Entity, Rectangle, ClassificationType, ImageMaterialProperty, Color,
} from 'cesium'

/**
 * Drapes a raster tile layer (radar, night lights, …) onto the globe AND the
 * Google photorealistic 3D tileset.
 *
 * Why not viewer.imageryLayers? Imagery layers render on the ellipsoid globe,
 * which this app hides entirely beneath the photorealistic tileset — they are
 * invisible. A classification rectangle (classificationType BOTH) is the only
 * mechanism that drapes onto 3D Tiles, but it needs a single equirectangular
 * image. So: fetch the tile pyramid at a fixed zoom, mosaic to a canvas, and
 * (for Web Mercator sources) reproject rows to equirectangular.
 */

const OUT_W = 4096
const OUT_H = 2048
const TILE = 256

export interface TileDrapeOptions {
  opacity: number
  /** Hide below this camera altitude (metres) — same rationale as HeatmapLayer */
  minVisibleHeight?: number
}

export class TileDrapeLayer {
  private viewer: Viewer
  private entity: Entity | null = null
  private options: TileDrapeOptions
  private cameraListener: (() => void) | null = null
  private canvases: [HTMLCanvasElement, HTMLCanvasElement]
  private backIndex = 0
  private loadSeq = 0

  constructor(viewer: Viewer, options: TileDrapeOptions) {
    this.viewer = viewer
    this.options = options
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = OUT_W
      c.height = OUT_H
      return c
    }
    this.canvases = [mk(), mk()]

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

  private loadTile(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  /**
   * Load a Web Mercator tile source ({z}/{x}/{y}) at a fixed zoom level,
   * mosaic, reproject to equirectangular, and drape.
   * level 3 → 8×8 tiles (2048² mercator). ±85.05° coverage; poles left clear.
   */
  async loadMercator(urlTemplate: string, level: number): Promise<boolean> {
    const seq = ++this.loadSeq
    const n = 1 << level
    const mercSize = n * TILE

    const merc = document.createElement('canvas')
    merc.width = mercSize
    merc.height = mercSize
    const mctx = merc.getContext('2d')!

    const jobs: Promise<void>[] = []
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const url = urlTemplate.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))
        jobs.push(this.loadTile(url).then((img) => {
          if (img) mctx.drawImage(img, x * TILE, y * TILE)
        }))
      }
    }
    await Promise.all(jobs)
    if (seq !== this.loadSeq) return false // superseded by a newer load

    // Reproject mercator → equirectangular, row by row
    const out = this.canvases[this.backIndex]
    this.backIndex = 1 - this.backIndex
    const octx = out.getContext('2d')!
    octx.clearRect(0, 0, OUT_W, OUT_H)

    const MAX_LAT = 85.05112878
    for (let y = 0; y < OUT_H; y++) {
      const lat = 90 - ((y + 0.5) / OUT_H) * 180
      if (Math.abs(lat) >= MAX_LAT) continue
      const latRad = (lat * Math.PI) / 180
      const mercFrac = (1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2
      const srcY = mercFrac * mercSize
      octx.drawImage(merc, 0, srcY, mercSize, Math.max(mercSize / OUT_H, 1), 0, y, OUT_W, 1)
    }

    this.present(out)
    return true
  }

  /**
   * Load a geographic (equirectangular, EPSG:4326) tile source at a fixed
   * level. GeographicTilingScheme: level L → 2^(L+1) columns × 2^L rows.
   * No reprojection needed — direct mosaic.
   */
  async loadGeographic(urlTemplate: string, level: number): Promise<boolean> {
    const seq = ++this.loadSeq
    const cols = 1 << (level + 1)
    const rows = 1 << level

    const out = this.canvases[this.backIndex]
    this.backIndex = 1 - this.backIndex
    const octx = out.getContext('2d')!
    octx.clearRect(0, 0, OUT_W, OUT_H)

    const cw = OUT_W / cols
    const ch = OUT_H / rows

    const jobs: Promise<void>[] = []
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const url = urlTemplate.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))
        jobs.push(this.loadTile(url).then((img) => {
          if (img) octx.drawImage(img, x * cw, y * ch, cw, ch)
        }))
      }
    }
    await Promise.all(jobs)
    if (seq !== this.loadSeq) return false

    this.present(out)
    return true
  }

  private present(canvas: HTMLCanvasElement) {
    if (this.entity) {
      const mat = this.entity.rectangle!.material as ImageMaterialProperty
      // @ts-expect-error — ImageMaterialProperty.image accepts raw values at runtime
      mat.image = canvas
    } else {
      this.entity = this.viewer.entities.add({
        rectangle: {
          coordinates: Rectangle.fromDegrees(-180, -90, 180, 90),
          material: new ImageMaterialProperty({
            image: canvas,
            transparent: true,
            // Multiplied over the texture — bakes in layer opacity
            color: Color.WHITE.withAlpha(this.options.opacity),
          }),
          classificationType: ClassificationType.BOTH,
        },
      })
    }
    this.applyHeightVisibility()
    this.viewer.scene.requestRender()
  }

  destroy() {
    this.loadSeq++
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
