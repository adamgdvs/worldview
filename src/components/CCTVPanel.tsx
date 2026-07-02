import { useState, useCallback } from 'react'
import { X, Video, MapPin } from 'lucide-react'
import { proxyImageUrl, type CameraFeed, type CameraCountry } from '../adapters/cctv'
import { useStore } from '../store'

const PAGE_SIZE = 30

const SOURCE_LABELS: Record<string, string> = {
  tfl: 'TfL',
  austin: 'ATX',
  tfnsw: 'NSW',
}

const COUNTRY_COLORS: Record<string, string> = {
  GB: '#00D4FF',
  US: '#FF9500',
  AU: '#39FF14',
}

interface CCTVPanelProps {
  cameras: CameraFeed[]
  totalOnline: number
  totalCameras: number
  availableCountries: CameraCountry[]
  onFlyTo: (cam: CameraFeed) => void
}

export function CCTVPanel({ cameras, totalOnline, totalCameras, availableCountries, onFlyTo }: CCTVPanelProps) {
  const cctvCountryFilter = useStore((s) => s.cctvCountryFilter)
  const setCctvCountryFilter = useStore((s) => s.setCctvCountryFilter)
  const selectedCameraId = useStore((s) => s.selectedCameraId)
  const setSelectedCameraId = useStore((s) => s.setSelectedCameraId)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const selectedCamera = cameras.find(c => c.id === selectedCameraId)

  const filtered = cctvCountryFilter === 'ALL'
    ? cameras
    : cameras.filter(c => c.country === cctvCountryFilter)

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const handleSelect = useCallback((cam: CameraFeed) => {
    setSelectedCameraId(cam.id)
  }, [setSelectedCameraId])

  return (
    <div className="absolute right-[220px] top-[50%] -translate-y-1/2 z-20 pointer-events-auto w-[280px] max-h-[80vh] flex flex-col glass-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-worldview-border shrink-0">
        <div className="flex items-center gap-2">
          <Video size={12} className="text-worldview-cyan" />
          <span className="text-[9px] text-worldview-cyan font-bold tracking-[2px]">CCTV</span>
        </div>
        <button
          onClick={() => useStore.getState().toggleLayer('cctv')}
          className="text-[#666666] hover:text-worldview-cyan transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-b border-worldview-border/50 shrink-0">
        <span className="text-[8px] text-[#555555] font-mono tracking-widest">
          CAMERAS ONLINE: <span className="text-worldview-text-bright">{totalOnline}</span> / {totalCameras}
        </span>
      </div>

      {/* Region filter */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-worldview-border/50 shrink-0">
        <FilterButton
          label="ALL"
          active={cctvCountryFilter === 'ALL'}
          onClick={() => setCctvCountryFilter('ALL')}
        />
        {availableCountries.map(c => (
          <FilterButton
            key={c.code}
            label={`${c.flag} ${c.code}`}
            count={c.count}
            active={cctvCountryFilter === c.code}
            color={COUNTRY_COLORS[c.code]}
            onClick={() => setCctvCountryFilter(c.code)}
          />
        ))}
      </div>

      {/* Selected camera preview */}
      {selectedCamera && (
        <div className="px-3 py-2 border-b border-worldview-border/50 shrink-0">
          <CameraPreview camera={selectedCamera} onFlyTo={onFlyTo} />
        </div>
      )}

      {/* Thumbnail grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        <div className="grid grid-cols-3 gap-1.5">
          {visible.map(cam => (
            <CameraThumbnail
              key={cam.id}
              camera={cam}
              selected={cam.id === selectedCameraId}
              onClick={() => handleSelect(cam)}
            />
          ))}
        </div>
        {hasMore && (
          <button
            onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
            className="w-full mt-2 py-1.5 text-[8px] text-worldview-cyan/70 font-bold tracking-[2px] border border-worldview-border/30 hover:border-worldview-cyan/40 hover:text-worldview-cyan transition-colors"
          >
            LOAD MORE ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FilterButton({ label, count, active, color, onClick }: {
  label: string; count?: number; active: boolean; color?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[8px] font-bold tracking-wider border transition-colors ${
        active
          ? 'border-worldview-cyan bg-worldview-cyan/10 text-worldview-cyan'
          : 'border-worldview-border/40 text-[#666666] hover:border-worldview-cyan/30'
      }`}
      style={active && color ? { borderColor: color, color, background: `${color}15` } : undefined}
    >
      {label}{count != null ? ` (${count})` : ''}
    </button>
  )
}

function CameraPreview({ camera, onFlyTo }: { camera: CameraFeed; onFlyTo: (cam: CameraFeed) => void }) {
  const [imgError, setImgError] = useState(false)
  const color = COUNTRY_COLORS[camera.country] ?? '#00D4FF'

  return (
    <div>
      <div className="aspect-video bg-black/50 border border-worldview-border/30 overflow-hidden mb-1.5">
        {imgError || !camera.imageUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[8px] text-worldview-red/60 font-mono tracking-widest">SIGNAL LOST</span>
          </div>
        ) : (
          <img
            src={proxyImageUrl(camera.imageUrl)}
            alt={camera.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] text-worldview-text-bright font-mono truncate">{camera.name}</div>
          <div className="text-[7px] text-[#555555] font-mono">
            {camera.latitude.toFixed(4)}, {camera.longitude.toFixed(4)}
          </div>
        </div>
        <button
          onClick={() => onFlyTo(camera)}
          className="shrink-0 flex items-center gap-1 px-2 py-1 text-[7px] font-bold tracking-wider border transition-colors hover:bg-white/5"
          style={{ borderColor: color, color }}
        >
          <MapPin size={8} />
          FLY TO
        </button>
      </div>
    </div>
  )
}

function CameraThumbnail({ camera, selected, onClick }: {
  camera: CameraFeed; selected: boolean; onClick: () => void
}) {
  const [imgError, setImgError] = useState(false)
  const color = COUNTRY_COLORS[camera.country] ?? '#00D4FF'

  return (
    <button
      onClick={onClick}
      className={`relative overflow-hidden border transition-colors ${
        selected
          ? 'border-worldview-cyan'
          : 'border-worldview-border/30 hover:border-worldview-cyan/40'
      }`}
    >
      {/* Image */}
      <div className="aspect-[4/3] bg-black/50">
        {imgError || !camera.imageUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[6px] text-worldview-red/50 font-mono">SIGNAL LOST</span>
          </div>
        ) : (
          <img
            src={proxyImageUrl(camera.imageUrl)}
            alt={camera.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Source badge */}
      <div
        className="absolute top-0.5 left-0.5 px-1 py-px text-[5px] font-bold tracking-wider"
        style={{ background: `${color}30`, color }}
      >
        {SOURCE_LABELS[camera.source] ?? camera.source}
      </div>

      {/* Online indicator */}
      {camera.available && (
        <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-400" />
      )}

      {/* Name */}
      <div className="px-1 py-0.5 bg-[#111111]/80">
        <div className="text-[6px] text-worldview-text-bright font-mono truncate">{camera.name}</div>
      </div>
    </button>
  )
}
