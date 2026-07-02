import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'

export interface IntelFeedItem {
  id: string
  time: string
  type: 'flight' | 'seismic' | 'satellite' | 'system' | 'cctv' | 'ship' | 'fire' | 'weather' | 'gpsjam'
  message: string
}

const TYPE_STYLES: Record<string, string> = {
  flight:    'text-[#00D4FF]',  // wv-cyan
  seismic:   'text-[#FF9500]',  // wv-amber
  satellite: 'text-[#39FF14]',  // wv-green
  system:    'text-[#666666]',  // wv-muted
  cctv:      'text-[#FF3B30]',  // wv-red
  ship:      'text-[#00D4FF]',  // wv-cyan
  fire:      'text-[#FF3B30]',  // wv-red
  weather:   'text-[#A78BFA]',
  gpsjam:    'text-[#FFD700]',
}

const TYPE_LABELS: Record<string, string> = {
  flight:    'ACFT',
  seismic:   'SEIS',
  satellite: 'SATS',
  system:    'SYS ',
  cctv:      'CCTV',
  ship:      'AIS ',
  fire:      'FIRE',
  weather:   'WTHR',
  gpsjam:    'GPSJ',
}

function ts() {
  return new Date().toISOString().slice(11, 19)
}

interface IntelFeedProps {
  flights: Map<string, any>
  militaryFlights: Map<string, any>
  vessels: Map<number, any>
  seismicEvents: any[]
  sats: any[]
  wildfires: any[]
}

export function IntelFeed({ flights, militaryFlights, vessels, seismicEvents, sats, wildfires }: IntelFeedProps) {
  const [items, setItems] = useState<IntelFeedItem[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const prevCounts = useRef({ flights: 0, mil: 0, vessels: 0, sats: 0, fires: 0, quakes: 0, lastCountMsg: 0 })
  const bootDone = useRef(false)
  const activeLayers = useStore((s) => s.activeLayers)

  // Boot messages on mount
  useEffect(() => {
    if (bootDone.current) return
    bootDone.current = true
    const t = ts()
    setItems([
      { id: 'boot-1', time: t, type: 'system', message: 'WORLDVIEW v2.0 INITIALISING...' },
      { id: 'boot-2', time: t, type: 'system', message: 'CESIUM 3D ENGINE LOADED' },
      { id: 'boot-3', time: t, type: 'system', message: 'GOOGLE PHOTOREALISTIC 3D TILES CONNECTED' },
      { id: 'boot-4', time: t, type: 'system', message: 'TACTICAL DISPLAY ONLINE' },
    ])
  }, [])

  // Generate feed items from data changes
  useEffect(() => {
    const prev = prevCounts.current
    const newItems: IntelFeedItem[] = []
    const t = ts()

    // Throttle rolling count updates — during WebSocket ramp-up the deltas
    // fire every render and flood the feed
    const now = Date.now()
    const countUpdateDue = now - (prev.lastCountMsg ?? 0) > 60_000

    // Civil flights
    const flightCount = flights.size
    if (flightCount > 0 && (prev.flights === 0 || (countUpdateDue && Math.abs(flightCount - prev.flights) > 50))) {
      newItems.push({
        id: `flt-${Date.now()}`,
        time: t,
        type: 'flight',
        message: `${flightCount.toLocaleString()} aircraft tracked worldwide`,
      })
      prev.flights = flightCount
      prev.lastCountMsg = now
    }

    // Military flights
    const milCount = militaryFlights.size
    if (milCount > 0 && (prev.mil === 0 || (countUpdateDue && Math.abs(milCount - prev.mil) > 10))) {
      newItems.push({
        id: `mil-${Date.now()}`,
        time: t,
        type: 'flight',
        message: `${milCount} military aircraft tracked`,
      })
      prev.mil = milCount
      prev.lastCountMsg = now
    }

    // Vessels
    const vesselCount = vessels.size
    if (vesselCount > 0 && (prev.vessels === 0 || (countUpdateDue && Math.abs(vesselCount - prev.vessels) > 30))) {
      newItems.push({
        id: `ais-${Date.now()}`,
        time: t,
        type: 'ship',
        message: `${vesselCount.toLocaleString()} vessels tracked via AIS`,
      })
      prev.vessels = vesselCount
      prev.lastCountMsg = now
    }

    // Satellites
    const satCount = sats.length
    if (satCount > 0 && prev.sats === 0) {
      newItems.push({
        id: `sat-${Date.now()}`,
        time: t,
        type: 'satellite',
        message: `${satCount} station satellites tracked`,
      })
      prev.sats = satCount
    }

    // Seismic — report significant quakes (M4+)
    if (seismicEvents.length > 0 && prev.quakes !== seismicEvents.length) {
      const significant = seismicEvents
        .filter((q: any) => q.magnitude >= 4.0)
        .slice(0, 3)
      for (const q of significant) {
        newItems.push({
          id: `eq-${q.id ?? Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          time: new Date(q.time).toISOString().slice(11, 19),
          type: 'seismic',
          message: `M${q.magnitude.toFixed(1)} — ${q.place}`,
        })
      }
      prev.quakes = seismicEvents.length
    }

    // Wildfires
    const fireCount = wildfires.length
    if (fireCount > 0 && prev.fires === 0) {
      newItems.push({
        id: `fire-${Date.now()}`,
        time: t,
        type: 'fire',
        message: `${fireCount} active fire hotspots detected (VIIRS)`,
      })
      prev.fires = fireCount
    }

    if (newItems.length > 0) {
      setItems(prev => [...prev, ...newItems].slice(-30))
    }
  }, [flights, militaryFlights, vessels, seismicEvents, sats, wildfires])

  // Layer activation messages
  const prevLayers = useRef<string[]>([])
  useEffect(() => {
    const prev = prevLayers.current
    const added = activeLayers.filter(l => !prev.includes(l))
    if (added.length > 0 && prev.length > 0) {
      const layerNames: Record<string, string> = {
        'avi-civil': 'CIVIL AVIATION', 'avi-mil': 'MILITARY AVIATION',
        'satellites': 'SATELLITES', 'maritime': 'MARITIME AIS',
        'seismic': 'SEISMIC', 'fires': 'FIRES (FIRMS)',
        'airq': 'AIR QUALITY', 'weather': 'WEATHER',
        'nightlights': 'NIGHTLIGHTS', 'gpsjam': 'GPS JAMMING',
        'traffic': 'TRAFFIC', 'cctv': 'CCTV',
      }
      const t = ts()
      const newItems = added.map(l => ({
        id: `layer-${l}-${Date.now()}`,
        time: t,
        type: 'system' as const,
        message: `${layerNames[l] || l.toUpperCase()} LAYER ACTIVATED`,
      }))
      setItems(prev => [...prev, ...newItems].slice(-30))
    }
    prevLayers.current = [...activeLayers]
  }, [activeLayers])

  return (
    <div
      className="glass-panel rounded-lg overflow-hidden select-none"
      style={{ width: '100%' }}
    >
      {/* Header */}
      <div
        className="px-3 py-1.5 border-b border-[#2A2A2A] flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00F0FF] opacity-50" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00F0FF]" />
          </span>
          <span className="text-[8px] text-white/30 tracking-[0.2em] uppercase font-bold">Intel Feed</span>
        </div>
        <span className="text-[8px] text-white/20">{collapsed ? '▶' : '▼'}</span>
      </div>

      {/* Feed content */}
      {!collapsed && (
        <div className="max-h-48 overflow-y-auto p-2 no-scrollbar">
          {items.map((item) => (
            <div key={item.id} className="flex gap-1.5 py-[2px] text-[8px] leading-tight">
              <span className="text-white/20 shrink-0 tabular-nums">{item.time}</span>
              <span className={`shrink-0 font-bold ${TYPE_STYLES[item.type]}`}>
                [{TYPE_LABELS[item.type]}]
              </span>
              <span className="text-white/50">{item.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
