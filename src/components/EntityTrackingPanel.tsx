import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Plane, Satellite, Ship, Shield } from 'lucide-react'

type EntityType = 'flight' | 'militaryFlight' | 'satellite' | 'vessel'

interface Props {
  trackedEntity: { type: string; key: string }
  flightsRef: React.MutableRefObject<Map<string, any>>
  milFlightsRef: React.MutableRefObject<Map<string, any>>
  satsDataRef: React.MutableRefObject<any[]>
  vesselsRef: React.MutableRefObject<Map<number, any>>
}

const ACCENT: Record<EntityType, string> = {
  flight: '#00e5ff',
  militaryFlight: '#ff6b35',
  satellite: '#ffd700',
  vessel: '#00e676',
}

const LABEL: Record<EntityType, string> = {
  flight: 'Aircraft',
  militaryFlight: 'Military Aircraft',
  satellite: 'Satellite',
  vessel: 'Vessel',
}

const ICON: Record<EntityType, typeof Plane> = {
  flight: Plane,
  militaryFlight: Shield,
  satellite: Satellite,
  vessel: Ship,
}

function getEntityData(
  type: EntityType,
  key: string,
  flightsRef: Props['flightsRef'],
  milFlightsRef: Props['milFlightsRef'],
  satsDataRef: Props['satsDataRef'],
  vesselsRef: Props['vesselsRef'],
): { title: string; rows: [string, string][] } | null {
  if (type === 'flight') {
    const f = flightsRef.current.get(key) ?? milFlightsRef.current.get(key)
    if (!f) return null
    const altM = f.baro_altitude ?? f.geo_altitude ?? 0
    const altFt = Math.round(altM * 3.28084)
    const speedKt = f.velocity != null ? Math.round(f.velocity * 1.94384) : null
    const heading = f.true_track != null ? Math.round(f.true_track) : null
    const vertRate = f.vertical_rate != null ? Math.round(f.vertical_rate * 196.85) : null
    const callsign = (f.callsign ?? '').trim() || key.toUpperCase()
    return {
      title: callsign,
      rows: [
        ['CALLSIGN', callsign],
        ['ICAO24', key.toUpperCase()],
        ['ALTITUDE', altFt > 0 ? `${altFt.toLocaleString()} ft (${Math.round(altM)} m)` : 'GND'],
        ['SPEED', speedKt != null ? `${speedKt} kt` : '—'],
        ['HEADING', heading != null ? `${heading}°` : '—'],
        ['VERT RATE', vertRate != null ? `${vertRate > 0 ? '+' : ''}${vertRate} ft/min` : '—'],
        ['SQUAWK', f.squawk || '—'],
        ['ORIGIN', f.origin_country || '—'],
      ],
    }
  }

  if (type === 'militaryFlight') {
    const f = milFlightsRef.current.get(key) ?? flightsRef.current.get(key)
    if (!f) return null
    const altM = f.baro_altitude ?? f.geo_altitude ?? 0
    const altFt = Math.round(altM * 3.28084)
    const speedKt = f.velocity != null ? Math.round(f.velocity * 1.94384) : null
    const heading = f.true_track != null ? Math.round(f.true_track) : null
    const vertRate = f.vertical_rate != null ? Math.round(f.vertical_rate * 196.85) : null
    const callsign = (f.callsign ?? '').trim() || key.toUpperCase()
    return {
      title: callsign,
      rows: [
        ['CALLSIGN', callsign],
        ['ICAO24', key.toUpperCase()],
        ['ALTITUDE', altFt > 0 ? `${altFt.toLocaleString()} ft (${Math.round(altM)} m)` : 'GND'],
        ['SPEED', speedKt != null ? `${speedKt} kt` : '—'],
        ['HEADING', heading != null ? `${heading}°` : '—'],
        ['VERT RATE', vertRate != null ? `${vertRate > 0 ? '+' : ''}${vertRate} ft/min` : '—'],
        ['SQUAWK', f.squawk || '—'],
      ],
    }
  }

  if (type === 'satellite') {
    const s = satsDataRef.current.find((sat: any) => sat.id === key)
    if (!s) return null
    const name = s.name || s.satname || key
    const altKm = s.altitudeKm ?? (s.satalt != null ? s.satalt : null)
    const velocityKmS = altKm != null ? Math.sqrt(398600.4418 / (6371 + altKm)) : null
    const period = altKm != null ? (2 * Math.PI * (6371 + altKm)) / (velocityKmS! * 60) : null
    const orbitType = altKm != null
      ? altKm < 2000 ? 'LEO' : altKm < 20200 ? 'MEO' : altKm < 36000 ? 'GEO' : 'HEO'
      : '—'
    return {
      title: name,
      rows: [
        ['NAME', name],
        ['NORAD ID', key],
        ['ALTITUDE', altKm != null ? `${Math.round(altKm).toLocaleString()} km` : '—'],
        ['ORBIT TYPE', orbitType],
        ['VELOCITY', velocityKmS != null ? `${velocityKmS.toFixed(1)} km/s` : '—'],
        ['INCL', s.inclination != null ? `${s.inclination.toFixed(1)}°` : '—'],
        ['PERIOD', period != null ? `${Math.round(period)} min` : '—'],
        ['LAT/LON', s.latitude != null && s.longitude != null
          ? `${s.latitude.toFixed(2)}° / ${s.longitude.toFixed(2)}°` : '—'],
      ],
    }
  }

  if (type === 'vessel') {
    const v = vesselsRef.current.get(Number(key))
    if (!v) return null
    const name = v.name || v.shipName || `MMSI ${key}`
    return {
      title: name,
      rows: [
        ['NAME', name],
        ['MMSI', String(key)],
        ['SPEED', v.speed != null ? `${v.speed.toFixed(1)} kn` : '—'],
        ['COURSE', v.course != null ? `${Math.round(v.course)}°` : '—'],
        ['TYPE', v.shipType || v.type || '—'],
        ['STATUS', v.navStatus || v.status || '—'],
        ['LAT/LON', v.latitude != null && v.longitude != null
          ? `${v.latitude.toFixed(4)}° / ${v.longitude.toFixed(4)}°` : '—'],
      ],
    }
  }

  return null
}

export function EntityTrackingPanel({
  trackedEntity,
  flightsRef,
  milFlightsRef,
  satsDataRef,
  vesselsRef,
}: Props) {
  const setTrackedEntity = useStore((s) => s.setTrackedEntity)
  const [data, setData] = useState<{ title: string; rows: [string, string][] } | null>(null)

  const entityType = trackedEntity.type as EntityType

  useEffect(() => {
    const update = () => {
      const d = getEntityData(entityType, trackedEntity.key, flightsRef, milFlightsRef, satsDataRef, vesselsRef)
      if (d) setData(d)
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [entityType, trackedEntity.key, flightsRef, milFlightsRef, satsDataRef, vesselsRef])

  if (!data) return null

  const accent = ACCENT[entityType] || '#00e5ff'
  const label = LABEL[entityType] || 'Entity'
  const IconComp = ICON[entityType] || Plane

  return (
    <div className="fixed z-50 pointer-events-auto"
      style={{
        bottom: '170px',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '520px',
        width: '100%',
      }}
    >
      <div className="glass-panel border border-white/10 rounded-lg px-5 py-3.5"
        style={{
          background: 'rgba(8, 14, 28, 0.88)',
          backdropFilter: 'blur(16px)',
          fontFamily: '"Space Mono", "JetBrains Mono", monospace',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2.5">
          <IconComp size={14} style={{ color: accent }} className="shrink-0" />
          <span className="text-[9px] tracking-[0.2em] text-white/40 uppercase">
            {label} • Tracking
          </span>
          <span className="text-sm font-bold ml-1" style={{ color: accent }}>
            {data.title}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: accent }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: accent }} />
              </span>
              <span className="text-[9px] tracking-wider uppercase" style={{ color: accent, opacity: 0.8 }}>Lock</span>
            </div>
            <button
              onClick={() => setTrackedEntity(null)}
              className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded border cursor-pointer hover:bg-white/10 transition-colors"
              style={{ color: accent, borderColor: `${accent}44` }}
            >
              Untrack
            </button>
          </div>
        </div>

        {/* Data grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {data.rows.map(([rowLabel, value]) => (
            <div key={rowLabel} className="flex items-baseline gap-2">
              <span className="text-[8px] tracking-[0.15em] text-white/30 uppercase shrink-0 w-16">
                {rowLabel}
              </span>
              <span className="text-[11px] truncate" style={{ color: accent }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-2.5 pt-2 border-t border-[#2A2A2A] text-center">
          <span className="text-[8px] tracking-[0.15em] text-white/25 uppercase">
            Click empty space or press ESC to unlock
          </span>
        </div>
      </div>
    </div>
  )
}
