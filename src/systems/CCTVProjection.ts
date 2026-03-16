// @ts-ignore
import {
  BillboardCollection, Cartesian3, Color, NearFarScalar,
  HorizontalOrigin, VerticalOrigin,
} from 'cesium'
import { fetchCCTVSnapshot, type CCTVFeed } from '../adapters/cctv'

// 64x64 placeholder: camera icon on dark background
function createPlaceholderImage(): string {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Dark background with border
  ctx.fillStyle = '#0a1628'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#00f0ff'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)

  // Camera icon (simple)
  ctx.fillStyle = '#00f0ff'
  ctx.fillRect(18, 24, 28, 20)
  ctx.beginPath()
  ctx.moveTo(46, 28)
  ctx.lineTo(54, 22)
  ctx.lineTo(54, 46)
  ctx.lineTo(46, 40)
  ctx.fill()

  // "CCTV" text
  ctx.font = 'bold 8px monospace'
  ctx.fillStyle = '#00f0ff'
  ctx.textAlign = 'center'
  ctx.fillText('CCTV', size / 2, 56)

  return canvas.toDataURL()
}

interface ActiveFeed {
  feed: CCTVFeed
  billboard: any
  objectUrl: string | null
  intervalId: ReturnType<typeof setInterval> | null
}

export class CCTVProjectionSystem {
  private collection: BillboardCollection
  private viewer: any
  private activeFeeds: Map<string, ActiveFeed> = new Map()
  private placeholderImage: string

  constructor(viewer: any) {
    this.viewer = viewer
    this.collection = new BillboardCollection()
    viewer.scene.primitives.add(this.collection)
    this.placeholderImage = createPlaceholderImage()
  }

  setFeeds(feeds: CCTVFeed[]) {
    const incoming = new Set(feeds.map(f => f.id))

    // Remove feeds no longer in set
    for (const [id, active] of this.activeFeeds) {
      if (!incoming.has(id)) {
        this.removeFeed(active)
        this.activeFeeds.delete(id)
      }
    }

    // Add new feeds
    for (const feed of feeds) {
      if (this.activeFeeds.has(feed.id)) continue

      const billboard = this.collection.add({
        position: Cartesian3.fromDegrees(feed.longitude, feed.latitude, 150),
        image: this.placeholderImage,
        width: 64,
        height: 64,
        id: { type: 'cctv', key: feed.id },
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(200, 1.2, 5e4, 0.3),
        translucencyByDistance: new NearFarScalar(200, 1.0, 1e5, 0.0),
        color: Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // always on top of 3D tiles
      })

      const active: ActiveFeed = { feed, billboard, objectUrl: null, intervalId: null }

      // Fetch initial snapshot
      this.refreshFeed(active)

      // Set up periodic refresh
      active.intervalId = setInterval(() => this.refreshFeed(active), feed.refreshInterval)

      this.activeFeeds.set(feed.id, active)
    }

    this.viewer.scene.requestRender()
  }

  private async refreshFeed(active: ActiveFeed) {
    const url = await fetchCCTVSnapshot(active.feed)
    if (!url) return

    // Revoke old blob URL to prevent memory leak
    if (active.objectUrl && active.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(active.objectUrl)
    }
    active.objectUrl = url

    // Create a scaled image for the billboard
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160; canvas.height = 120
        const ctx = canvas.getContext('2d')!

        // Draw camera feed
        ctx.drawImage(img, 0, 0, 160, 120)

        // Border
        ctx.strokeStyle = '#00f0ff'
        ctx.lineWidth = 2
        ctx.strokeRect(1, 1, 158, 118)

        // Label bar at bottom
        ctx.fillStyle = 'rgba(10, 22, 40, 0.85)'
        ctx.fillRect(0, 104, 160, 16)
        ctx.font = 'bold 9px monospace'
        ctx.fillStyle = '#00f0ff'
        ctx.textAlign = 'center'
        ctx.fillText(active.feed.name.substring(0, 20), 80, 115)

        active.billboard.image = canvas.toDataURL()
        this.viewer.scene.requestRender()
      } catch {
        // Canvas tainted by CORS — use placeholder with label instead
        this.applyLabelledPlaceholder(active)
      }
    }
    img.onerror = () => {
      // Image failed to load — use labelled placeholder
      this.applyLabelledPlaceholder(active)
    }
    img.src = url
  }

  private applyLabelledPlaceholder(active: ActiveFeed) {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = '#0a1628'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#00f0ff'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, size - 2, size - 2)

    // Camera icon
    ctx.fillStyle = '#00f0ff'
    ctx.fillRect(18, 20, 28, 18)
    ctx.beginPath()
    ctx.moveTo(46, 24)
    ctx.lineTo(54, 18)
    ctx.lineTo(54, 42)
    ctx.lineTo(46, 36)
    ctx.fill()

    // Name
    ctx.font = 'bold 7px monospace'
    ctx.fillStyle = '#00f0ff'
    ctx.textAlign = 'center'
    ctx.fillText(active.feed.name.substring(0, 12), size / 2, 52)
    ctx.fillStyle = '#5a7a9a'
    ctx.font = '6px monospace'
    ctx.fillText('LIVE', size / 2, 60)

    active.billboard.image = canvas.toDataURL()
    this.viewer.scene.requestRender()
  }

  getFeedById(id: string): CCTVFeed | undefined {
    return this.activeFeeds.get(id)?.feed
  }

  private removeFeed(active: ActiveFeed) {
    if (active.intervalId) clearInterval(active.intervalId)
    if (active.objectUrl) URL.revokeObjectURL(active.objectUrl)
    this.collection.remove(active.billboard)
  }

  destroy() {
    for (const [, active] of this.activeFeeds) {
      this.removeFeed(active)
    }
    this.activeFeeds.clear()
    this.viewer.scene.primitives.remove(this.collection)
  }
}
