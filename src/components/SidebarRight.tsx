import { X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useStore, type ShaderParams } from '../store'
import { fetchCCTVSnapshot } from '../adapters/cctv'
import { CollapsibleSection } from './ui/CollapsibleSection'
import { Slider } from './ui/Slider'

export function SidebarRight() {
  const selectedEntity = useStore((s) => s.selectedEntity)
  const setSelectedEntity = useStore((s) => s.setSelectedEntity)
  const cleanUI = useStore((s) => s.cleanUI)

  if (cleanUI) return null

  return (
    <div className="absolute top-[50%] -translate-y-1/2 right-3 z-20 pointer-events-auto w-[200px] max-h-[75vh] flex flex-col gap-2 overflow-y-auto no-scrollbar">
      {selectedEntity && (
        <div className="glass-panel overflow-hidden">
          <InspectPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
        </div>
      )}
      <ControlStack />
    </div>
  )
}

// ─── Control Stack ──────────────────────────────────────────────────────────

function ControlStack() {
  const activeMode = useStore((s) => s.activeMode)
  const shaderParams = useStore((s) => s.shaderParams)
  const setShaderParam = useStore((s) => s.setShaderParam)
  const hudLayout = useStore((s) => s.hudLayout)
  const setHudLayout = useStore((s) => s.setHudLayout)
  const toggleCleanUI = useStore((s) => s.toggleCleanUI)
  const showLabels = useStore((s) => s.showLabels)
  const toggleLabels = useStore((s) => s.toggleLabels)

  // Mode-specific slider config
  const modeSliders = getModeSliders(activeMode)

  return (
    <div className="flex flex-col gap-2">
      {/* DISPLAY (HUD + Labels) */}
      <div className="glass-panel px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-worldview-cyan font-bold tracking-[2px] uppercase">DISPLAY</span>
        </div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[8px] text-[#4a6385] tracking-widest font-bold uppercase">LAYOUT</span>
          <select
            value={hudLayout}
            onChange={(e) => setHudLayout(e.target.value as any)}
            className="bg-[#0a1628] border border-worldview-border/40 text-[8px] text-worldview-text-bright px-2 py-0.5 font-mono tracking-wider appearance-none cursor-pointer hover:border-worldview-cyan/50 transition-colors"
          >
            <option value="Tactical">Tactical</option>
            <option value="Minimal">Minimal</option>
            <option value="Full">Full</option>
          </select>
        </div>
        <div
          className="flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors py-0.5"
          onClick={toggleLabels}
        >
          <span className="text-[8px] text-[#4a6385] tracking-widest font-bold uppercase">LABELS</span>
          <div className={`w-5 h-2.5 rounded-full relative transition-colors ${showLabels ? 'bg-worldview-cyan' : 'bg-[#1E3050]'}`}>
            <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-worldview-bg transition-all ${showLabels ? 'left-3' : 'left-0.5'}`} />
          </div>
        </div>
      </div>

      {/* PARAMETERS (collapsible) */}
      <div className="glass-panel overflow-hidden">
        <CollapsibleSection id="params" title="PARAMETERS">
          <div className="px-3 pb-3 space-y-3">
            <div className="text-[8px] text-[#304c78] tracking-widest font-bold uppercase">
              MODE: <span className="text-worldview-cyan">{activeMode}</span>
            </div>
            {modeSliders.map((s) => (
              <Slider
                key={s.key}
                label={s.label}
                value={shaderParams[s.key]}
                onChange={(v) => setShaderParam(s.key, v)}
              />
            ))}
          </div>
        </CollapsibleSection>
      </div>

      {/* CLEAN UI */}
      <button
        onClick={toggleCleanUI}
        className="glass-panel px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[9px] text-[#5a7a9a] font-bold tracking-[2px] uppercase">CLEAN UI</span>
      </button>
    </div>
  )
}

// ─── Mode-specific slider config ────────────────────────────────────────────

function getModeSliders(mode: string): Array<{ label: string; key: keyof ShaderParams }> {
  switch (mode) {
    case 'Normal':
      return [
        { label: 'Bloom', key: 'bloom' },
        { label: 'Sharpen', key: 'sharpen' },
      ]
    case 'FLIR':
      return [
        { label: 'Sensitivity', key: 'bloom' },
        { label: 'WHOT/BHOT', key: 'grain' },
        { label: 'Sharpen', key: 'sharpen' },
        { label: 'Vignette', key: 'vignette' },
      ]
    case 'NVG':
      return [
        { label: 'Gain', key: 'bloom' },
        { label: 'Grain', key: 'grain' },
        { label: 'Sharpen', key: 'sharpen' },
        { label: 'Vignette', key: 'vignette' },
      ]
    case 'CRT':
      return [
        { label: 'Bloom', key: 'bloom' },
        { label: 'Scanlines', key: 'scanlines' },
        { label: 'Distortion', key: 'distortion' },
        { label: 'Vignette', key: 'vignette' },
      ]
    default:
      return [
        { label: 'Bloom', key: 'bloom' },
        { label: 'Sharpen', key: 'sharpen' },
        { label: 'Grain', key: 'grain' },
        { label: 'Vignette', key: 'vignette' },
      ]
  }
}

// ─── Small components ───────────────────────────────────────────────────────


// ─── Inspect Panel ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  flight: 'text-worldview-cyan',
  vessel: 'text-[#36D977]',
  seismic: 'text-worldview-orange',
  satellite: 'text-[#D4A017]',
  wildfire: 'text-worldview-red',
  cctv: 'text-worldview-cyan',
}

const TYPE_LABELS: Record<string, string> = {
  flight: 'FLIGHT',
  vessel: 'VESSEL',
  seismic: 'SEISMIC EVENT',
  satellite: 'SATELLITE',
  wildfire: 'WILDFIRE',
  cctv: 'CCTV FEED',
}

function InspectPanel({ entity, onClose }: { entity: { type: string; data: any }; onClose: () => void }) {
  const { type, data } = entity
  const color = TYPE_COLORS[type] || 'text-worldview-cyan'
  const trackedEntity = useStore((s) => s.trackedEntity)
  const setTrackedEntity = useStore((s) => s.setTrackedEntity)

  const trackable = type === 'flight' || type === 'vessel' || type === 'satellite'
  const trackKey = type === 'flight' ? data.icao24 : type === 'vessel' ? data.mmsi : type === 'satellite' ? data.id : null
  const isTracking = trackedEntity && trackedEntity.type === type && trackedEntity.key === trackKey

  const handleTrack = () => {
    if (isTracking) {
      setTrackedEntity(null)
    } else if (trackKey) {
      setTrackedEntity({ type: type as 'flight' | 'vessel' | 'satellite', key: trackKey })
    }
  }

  return (
    <div className="border-b border-worldview-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-worldview-border shrink-0">
        <span className={`text-[9px] font-bold tracking-widest ${color}`}>
          INSPECT / {TYPE_LABELS[type] || type.toUpperCase()}
        </span>
        <button
          onClick={onClose}
          className="text-[#5a7a9a] hover:text-worldview-cyan transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-48 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
        {type === 'flight' && <FlightDetail d={data} />}
        {type === 'vessel' && <VesselDetail d={data} />}
        {type === 'seismic' && <SeismicDetail d={data} />}
        {type === 'satellite' && <SatelliteDetail d={data} />}
        {type === 'wildfire' && <WildfireDetail d={data} />}
        {type === 'cctv' && <CCTVDetail d={data} />}
      </div>

      {/* Track button */}
      {trackable && (
        <div className="px-3 py-2 shrink-0">
          <button
            onClick={handleTrack}
            className={`w-full py-2 text-[10px] font-bold tracking-widest border transition-all ${
              isTracking
                ? 'border-worldview-red bg-worldview-red/10 text-worldview-red hover:bg-worldview-red/20'
                : 'border-worldview-cyan bg-worldview-cyan/10 text-worldview-cyan hover:bg-worldview-cyan/20'
            }`}
          >
            {isTracking ? 'STOP TRACKING' : 'TRACK'}
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[9px] text-[#4a6385] tracking-wider font-bold uppercase shrink-0">{label}</span>
      <span className="text-[10px] text-worldview-text-bright font-mono text-right truncate">
        {value ?? '—'}
      </span>
    </div>
  )
}

function FlightDetail({ d }: { d: any }) {
  return (
    <>
      <Row label="CALLSIGN" value={d.callsign || '—'} />
      <Row label="ICAO" value={d.icao24?.toUpperCase()} />
      <Row label="SQUAWK" value={d.squawk} />
      <Row label="BARO ALT" value={d.baro_altitude != null ? `${Math.round(d.baro_altitude)} m` : undefined} />
      <Row label="GEO ALT" value={d.geo_altitude != null ? `${Math.round(d.geo_altitude)} m` : undefined} />
      <Row label="SPEED" value={d.velocity != null ? `${Math.round(d.velocity)} m/s` : undefined} />
      <Row label="HEADING" value={d.true_track != null ? `${Math.round(d.true_track)}°` : undefined} />
      <Row label="VERT RATE" value={d.vertical_rate != null ? `${d.vertical_rate.toFixed(1)} m/s` : undefined} />
      <Row label="ON GROUND" value={d.on_ground ? 'YES' : 'NO'} />
      <Row label="ORIGIN" value={d.origin_country} />
    </>
  )
}

function VesselDetail({ d }: { d: any }) {
  return (
    <>
      <Row label="NAME" value={d.name} />
      <Row label="MMSI" value={d.mmsi} />
      <Row label="TYPE" value={d.shipType ?? d.type} />
      <Row label="SPEED" value={d.speed != null ? `${d.speed} kn` : undefined} />
      <Row label="COURSE" value={d.course != null ? `${Math.round(d.course)}°` : undefined} />
      <Row label="NAV STATUS" value={d.navStatus ?? d.navigationalStatus} />
      <Row label="LAST UPDATE" value={d.lastUpdate ? new Date(d.lastUpdate).toISOString().slice(11, 19) + 'Z' : undefined} />
    </>
  )
}

function SeismicDetail({ d }: { d: any }) {
  return (
    <>
      <Row label="MAGNITUDE" value={d.magnitude?.toFixed(1)} />
      <Row label="DEPTH" value={d.depth != null ? `${d.depth} km` : undefined} />
      <Row label="PLACE" value={d.place} />
      <Row label="TIME" value={d.time ? new Date(d.time).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : undefined} />
      <Row label="LAT" value={d.latitude?.toFixed(4)} />
      <Row label="LON" value={d.longitude?.toFixed(4)} />
    </>
  )
}

function SatelliteDetail({ d }: { d: any }) {
  return (
    <>
      <Row label="NAME" value={d.name} />
      <Row label="NORAD ID" value={d.noradId ?? d.id} />
      <Row label="ALTITUDE" value={d.altitudeKm != null ? `${Math.round(d.altitudeKm)} km` : undefined} />
      <Row label="CATALOG" value={d.catalog} />
      <Row label="LAT" value={d.latitude?.toFixed(4)} />
      <Row label="LON" value={d.longitude?.toFixed(4)} />
    </>
  )
}

function WildfireDetail({ d }: { d: any }) {
  return (
    <>
      <Row label="BRIGHTNESS" value={d.bright_ti4 ?? d.brightness ? `${Math.round(d.bright_ti4 ?? d.brightness)} K` : undefined} />
      <Row label="FRP" value={d.frp != null ? `${d.frp} MW` : undefined} />
      <Row label="CONFIDENCE" value={d.confidence === 'h' ? 'HIGH' : d.confidence === 'n' ? 'NOMINAL' : d.confidence === 'l' ? 'LOW' : d.confidence} />
      <Row label="ACQ DATE" value={d.acq_date} />
      <Row label="LAT" value={d.latitude?.toFixed(4)} />
      <Row label="LON" value={d.longitude?.toFixed(4)} />
    </>
  )
}

function CCTVDetail({ d }: { d: any }) {
  const setCctvViewerFeed = useStore((s) => s.setCctvViewerFeed)
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setSnapshotUrl(null)
    fetchCCTVSnapshot(d).then(url => {
      setSnapshotUrl(url)
      setLoading(false)
    })
    const interval = setInterval(async () => {
      const url = await fetchCCTVSnapshot(d)
      if (url) setSnapshotUrl(url)
    }, d.refreshInterval ?? 30_000)
    return () => {
      clearInterval(interval)
      if (snapshotUrl?.startsWith('blob:')) URL.revokeObjectURL(snapshotUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id])

  return (
    <>
      {/* Live feed preview — click to open large viewer */}
      <button
        onClick={() => setCctvViewerFeed(d)}
        className="w-full mb-2 border border-worldview-border/30 rounded overflow-hidden bg-black/50 hover:border-worldview-cyan/50 transition-colors cursor-pointer"
      >
        {loading ? (
          <div className="h-28 flex items-center justify-center text-[8px] text-[#5a7a9a] font-mono">
            LOADING FEED...
          </div>
        ) : snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt={d.name}
            className="w-full h-auto max-h-40 object-cover"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="h-28 flex items-center justify-center text-[8px] text-[#5a7a9a] font-mono">
            FEED UNAVAILABLE
          </div>
        )}
        <div className="flex items-center justify-between px-2 py-1 bg-[#0a1628]/80">
          <span className="text-[7px] text-worldview-cyan font-mono tracking-wider">LIVE</span>
          <span className="text-[6px] text-[#5a7a9a] font-mono">{new Date().toLocaleTimeString()}</span>
        </div>
      </button>
      <Row label="NAME" value={d.name} />
      <Row label="SOURCE" value={d.source} />
      <Row label="CITY" value={d.city} />
      <Row label="LAT" value={d.latitude?.toFixed(4)} />
      <Row label="LON" value={d.longitude?.toFixed(4)} />
    </>
  )
}
