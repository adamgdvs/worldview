import { X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'
import { proxyImageUrl } from '../adapters/cctv'

export function SidebarRight() {
  const selectedEntity = useStore((s) => s.selectedEntity)
  const setSelectedEntity = useStore((s) => s.setSelectedEntity)
  const cleanUI = useStore((s) => s.cleanUI)

  if (cleanUI) return null
  if (!selectedEntity) return null

  return (
    <div className="absolute top-[50%] -translate-y-1/2 right-3 z-40 pointer-events-auto w-[200px] max-h-[75vh] flex flex-col gap-2 overflow-y-auto no-scrollbar">
      <div className="glass-panel overflow-hidden">
        <InspectPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
      </div>
    </div>
  )
}

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
          className="text-[#666666] hover:text-worldview-cyan transition-colors"
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
      <span className="text-[9px] text-[#555555] tracking-wider font-bold uppercase shrink-0">{label}</span>
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
  const [imgError, setImgError] = useState(false)
  const imgSrc = d.imageUrl ? proxyImageUrl(d.imageUrl) : ''

  return (
    <>
      {/* Camera preview */}
      <div className="w-full mb-2 border border-worldview-border/30 rounded overflow-hidden bg-black/50">
        {imgError || !imgSrc ? (
          <div className="h-28 flex items-center justify-center text-[8px] text-worldview-red/50 font-mono">
            SIGNAL LOST
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={d.name}
            className="w-full h-auto max-h-40 object-cover"
            onError={() => setImgError(true)}
          />
        )}
      </div>
      <Row label="NAME" value={d.name} />
      <Row label="SOURCE" value={d.source} />
      <Row label="REGION" value={d.region} />
      <Row label="COUNTRY" value={d.countryName ?? d.country} />
      <Row label="LAT" value={d.latitude?.toFixed(4)} />
      <Row label="LON" value={d.longitude?.toFixed(4)} />
    </>
  )
}
