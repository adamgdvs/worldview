// @ts-ignore
import {
  Viewer, Entity, Rectangle, ClassificationType, ImageMaterialProperty, Color,
  Cartesian2, Cartographic, Math as CesiumMath,
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

  // Regional high-zoom refine (sharp overlay of the visible area)
  private regionEntity: Entity | null = null
  private regionSeq = 0
  private refineTemplate: string | null = null
  private refineTileSize = TILE
  private moveEndListener: (() => void) | null = null

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
   * level 3 → 8×8 tiles. ±85.05° coverage; poles left clear.
   */
  async loadMercator(urlTemplate: string, level: number, tileSize = TILE): Promise<boolean> {
    const seq = ++this.loadSeq
    const n = 1 << level
    const mercSize = n * tileSize

    const merc = document.createElement('canvas')
    merc.width = mercSize
    merc.height = mercSize
    const mctx = merc.getContext('2d')!

    const jobs: Promise<void>[] = []
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const url = urlTemplate.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))
        jobs.push(this.loadTile(url).then((img) => {
          if (img) mctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize)
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

  // ── Regional refine ────────────────────────────────────────────────────
  // The global drape caps out at ~10 km/px when zoomed in. This mosaics the
  // *visible* tile range at zoom 4–8 into a second classification rectangle
  // on every camera moveEnd, giving native-resolution radar up close while
  // the global drape still covers the rest of the planet.

  /** Enable (or update the frame template for) the regional refine pass. */
  enableMercatorRefine(urlTemplate: string, tileSize = TILE) {
    this.refineTemplate = urlTemplate
    this.refineTileSize = tileSize
    if (!this.moveEndListener) {
      this.moveEndListener = () => { void this.refreshRegion() }
      this.viewer.camera.moveEnd.addEventListener(this.moveEndListener)
    }
    void this.refreshRegion()
  }

  private removeRegion() {
    if (this.regionEntity) {
      this.viewer.entities.remove(this.regionEntity)
      this.regionEntity = null
      this.viewer.scene.requestRender()
    }
  }

  private async refreshRegion() {
    const template = this.refineTemplate
    if (!template) return
    const seq = ++this.regionSeq
    const viewer = this.viewer
    const camera = viewer.camera
    const height = camera.positionCartographic.height

    // Zoomed out → global drape is already adequate; drop the overlay
    if (height > 6_000_000) { this.removeRegion(); return }

    // Viewport bbox from ellipsoid corner picks (oblique views may miss)
    const canvas = viewer.scene.canvas
    const ellipsoid = viewer.scene.globe.ellipsoid
    const corners = [
      camera.pickEllipsoid(new Cartesian2(0, 0), ellipsoid),
      camera.pickEllipsoid(new Cartesian2(canvas.clientWidth, 0), ellipsoid),
      camera.pickEllipsoid(new Cartesian2(0, canvas.clientHeight), ellipsoid),
      camera.pickEllipsoid(new Cartesian2(canvas.clientWidth, canvas.clientHeight), ellipsoid),
    ].filter(Boolean)
    if (corners.length < 2) { this.removeRegion(); return }

    const cartos = corners.map(c => Cartographic.fromCartesian(c!, ellipsoid))
    const lats = cartos.map(c => CesiumMath.toDegrees(c.latitude))
    const lons = cartos.map(c => CesiumMath.toDegrees(c.longitude))
    const MAX_LAT = 85
    const minLat = Math.max(Math.min(...lats) - 1, -MAX_LAT)
    const maxLat = Math.min(Math.max(...lats) + 1, MAX_LAT)
    const minLon = Math.max(Math.min(...lons) - 1, -180)
    const maxLon = Math.min(Math.max(...lons) + 1, 180)
    const lonSpan = maxLon - minLon
    if (lonSpan <= 0 || maxLat <= minLat || lonSpan > 180) { this.removeRegion(); return }

    // Mercator helpers (global fraction 0..1, top = north)
    const mercY = (latDeg: number) => {
      const r = latDeg * Math.PI / 180
      return (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2
    }
    const invMercY = (f: number) =>
      (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * f))) - Math.PI / 2) * 180 / Math.PI

    // Zoom so ~6 tiles span the viewport width; back off if tile count blows up
    let level = Math.max(4, Math.min(8, Math.ceil(Math.log2(6 * 360 / lonSpan))))
    let n = 0, x0 = 0, x1 = 0, y0 = 0, y1 = 0
    for (;;) {
      n = 1 << level
      x0 = Math.max(0, Math.floor((minLon + 180) / 360 * n))
      x1 = Math.min(n - 1, Math.floor((maxLon + 180) / 360 * n))
      y0 = Math.max(0, Math.floor(mercY(maxLat) * n))
      y1 = Math.min(n - 1, Math.floor(mercY(minLat) * n))
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 80 || level <= 4) break
      level--
    }

    const T = this.refineTileSize
    const cols = x1 - x0 + 1
    const rows = y1 - y0 + 1
    const merc = document.createElement('canvas')
    merc.width = cols * T
    merc.height = rows * T
    const mctx = merc.getContext('2d')!

    const jobs: Promise<void>[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const url = template.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))
        jobs.push(this.loadTile(url).then((img) => {
          if (img) mctx.drawImage(img, (x - x0) * T, (y - y0) * T, T, T)
        }))
      }
    }
    await Promise.all(jobs)
    if (seq !== this.regionSeq || !this.refineTemplate) return

    // Tile-aligned geographic bounds of the mosaic
    const west = x0 / n * 360 - 180
    const east = (x1 + 1) / n * 360 - 180
    const north = invMercY(y0 / n)
    const south = invMercY((y1 + 1) / n)

    // Reproject mercator → equirectangular row by row within the region
    const out = document.createElement('canvas')
    out.width = merc.width
    out.height = merc.height
    const octx = out.getContext('2d')!
    for (let y = 0; y < out.height; y++) {
      const lat = north + ((y + 0.5) / out.height) * (south - north)
      const srcY = mercY(lat) * n * T - y0 * T
      octx.drawImage(merc, 0, srcY, merc.width, Math.max(merc.height / out.height, 1), 0, y, out.width, 1)
    }

    if (this.regionEntity) {
      // @ts-expect-error — runtime accepts raw values for entity properties
      this.regionEntity.rectangle.coordinates = Rectangle.fromDegrees(west, south, east, north)
      const mat = this.regionEntity.rectangle!.material as ImageMaterialProperty
      // @ts-expect-error — ImageMaterialProperty.image accepts raw values at runtime
      mat.image = out
    } else {
      this.regionEntity = this.viewer.entities.add({
        rectangle: {
          coordinates: Rectangle.fromDegrees(west, south, east, north),
          material: new ImageMaterialProperty({
            image: out,
            transparent: true,
            color: Color.WHITE.withAlpha(this.options.opacity),
          }),
          classificationType: ClassificationType.BOTH,
        },
      })
    }
    this.viewer.scene.requestRender()
  }

  destroy() {
    this.loadSeq++
    this.regionSeq++
    this.refineTemplate = null
    if (this.cameraListener) {
      this.viewer.camera.changed.removeEventListener(this.cameraListener)
      this.cameraListener = null
    }
    if (this.moveEndListener) {
      this.viewer.camera.moveEnd.removeEventListener(this.moveEndListener)
      this.moveEndListener = null
    }
    this.removeRegion()
    if (this.entity) {
      this.viewer.entities.remove(this.entity)
      this.entity = null
      this.viewer.scene.requestRender()
    }
  }
}
