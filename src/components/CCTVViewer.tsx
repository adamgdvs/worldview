import { useState, useEffect } from 'react'
import { X, RefreshCw, ExternalLink } from 'lucide-react'
import { fetchCCTVSnapshot, type CCTVFeed } from '../adapters/cctv'

interface CCTVViewerProps {
  feed: CCTVFeed
  onClose: () => void
}

export function CCTVViewer({ feed, onClose }: CCTVViewerProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const loadImage = async () => {
    setLoading(true)
    const url = await fetchCCTVSnapshot(feed)
    setSnapshotUrl(url)
    setLoading(false)
    setLastRefresh(new Date())
  }

  useEffect(() => {
    loadImage()
    const interval = setInterval(loadImage, feed.refreshInterval ?? 30_000)
    return () => {
      clearInterval(interval)
      if (snapshotUrl?.startsWith('blob:')) URL.revokeObjectURL(snapshotUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col glass-panel overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-worldview-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-worldview-cyan font-bold tracking-[2px]">CCTV FEED</span>
            <span className="text-[8px] text-worldview-cyan/60 font-mono px-1.5 py-0.5 border border-worldview-cyan/20 rounded">
              LIVE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadImage}
              className="text-[#5a7a9a] hover:text-worldview-cyan transition-colors p-1"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <a
              href={`https://www.windy.com/webcams/${feed.webcamId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5a7a9a] hover:text-worldview-cyan transition-colors p-1"
              title="Open on Windy"
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              className="text-[#5a7a9a] hover:text-worldview-cyan transition-colors p-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="flex-1 bg-black flex items-center justify-center min-h-[300px]">
          {loading && !snapshotUrl ? (
            <div className="text-[10px] text-[#5a7a9a] font-mono tracking-widest">
              LOADING FEED...
            </div>
          ) : snapshotUrl ? (
            <img
              src={snapshotUrl}
              alt={feed.name}
              className="w-full h-auto max-h-[60vh] object-contain"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="text-[10px] text-[#5a7a9a] font-mono tracking-widest">
              FEED UNAVAILABLE
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="px-4 py-2.5 border-t border-worldview-border shrink-0 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-worldview-text-bright font-mono truncate max-w-[70%]">
              {feed.name}
            </span>
            <span className="text-[8px] text-[#5a7a9a] font-mono">
              {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#4a6385] font-mono">
              {feed.source}
            </span>
            <span className="text-[8px] text-[#4a6385] font-mono">
              {feed.latitude.toFixed(4)}, {feed.longitude.toFixed(4)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
