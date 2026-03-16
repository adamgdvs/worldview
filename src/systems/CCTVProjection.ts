// @ts-ignore
import {
  BillboardCollection, Cartesian3, Color, NearFarScalar,
  HorizontalOrigin, VerticalOrigin,
} from 'cesium'
import type { CCTVFeed } from '../adapters/cctv'

// Render camcorder.svg as a cyan-tinted 24x24 data URL for CesiumJS billboards
function createCamcorderIcon(): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const size = 24
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, size, size)

      // Tint to cyan: draw the icon, then overlay with color using source-in composite
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = '#00f0ff'
      ctx.fillRect(0, 0, size, size)

      resolve(canvas.toDataURL())
    }
    img.onerror = () => {
      // Fallback: simple cyan dot
      const canvas = document.createElement('canvas')
      canvas.width = 16; canvas.height = 16
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#00f0ff'
      ctx.beginPath()
      ctx.arc(8, 8, 6, 0, Math.PI * 2)
      ctx.fill()
      resolve(canvas.toDataURL())
    }
    img.src = '/camcorder.svg'
  })
}

interface ActiveFeed {
  feed: CCTVFeed
  billboard: any
}

export class CCTVProjectionSystem {
  private collection: BillboardCollection
  private viewer: any
  private activeFeeds: Map<string, ActiveFeed> = new Map()
  private iconReady = false
  private iconDataUrl = ''
  private pendingFeeds: CCTVFeed[] | null = null

  constructor(viewer: any) {
    this.viewer = viewer
    // No scene arg — matches how all other working billboard collections are created
    this.collection = new BillboardCollection()
    viewer.scene.primitives.add(this.collection)

    // Load icon asynchronously
    createCamcorderIcon().then(url => {
      this.iconDataUrl = url
      this.iconReady = true
      // If feeds arrived before icon was ready, apply them now
      if (this.pendingFeeds) {
        this.setFeeds(this.pendingFeeds)
        this.pendingFeeds = null
      }
    })
  }

  setFeeds(feeds: CCTVFeed[]) {
    if (!this.iconReady) {
      this.pendingFeeds = feeds
      return
    }

    const incoming = new Set(feeds.map(f => f.id))

    // Remove feeds no longer present
    for (const [id, active] of this.activeFeeds) {
      if (!incoming.has(id)) {
        this.collection.remove(active.billboard)
        this.activeFeeds.delete(id)
      }
    }

    // Add new feeds as lightweight icons
    for (const feed of feeds) {
      if (this.activeFeeds.has(feed.id)) continue

      // Validate coordinates — skip feeds with invalid positions
      if (
        feed.latitude == null || feed.longitude == null ||
        !isFinite(feed.latitude) || !isFinite(feed.longitude) ||
        feed.latitude < -90 || feed.latitude > 90 ||
        feed.longitude < -180 || feed.longitude > 180
      ) continue

      const billboard = this.collection.add({
        position: Cartesian3.fromDegrees(feed.longitude, feed.latitude, 0),
        image: this.iconDataUrl,
        width: 24,
        height: 24,
        id: { type: 'cctv', key: feed.id },
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(200, 1.0, 5e6, 0.4),
        translucencyByDistance: new NearFarScalar(100, 1.0, 1e7, 0.6),
        color: Color.WHITE,
      })

      this.activeFeeds.set(feed.id, { feed, billboard })
    }

    if (feeds.length > 0) {
      console.info(`[CCTVProjection] ${this.activeFeeds.size} camera icons on globe`)
    }
    this.viewer.scene.requestRender()
  }

  getFeedById(id: string): CCTVFeed | undefined {
    return this.activeFeeds.get(id)?.feed
  }

  destroy() {
    for (const [, active] of this.activeFeeds) {
      this.collection.remove(active.billboard)
    }
    this.activeFeeds.clear()
    this.viewer.scene.primitives.remove(this.collection)
  }
}
