import { useStore } from '../store'
import { SatelliteLookup } from './SatelliteLookup'

const SAT_CATALOGS: { id: string; label: string; color: string }[] = [
  { id: 'notable',     label: 'Notable',     color: '#FF4444' },
  { id: 'stations',    label: 'Stations',    color: '#FF6B6B' },
  { id: 'visual',      label: 'Visual',      color: '#FFFFFF' },
  { id: 'weather',     label: 'Weather',     color: '#6699FF' },
  { id: 'earth-obs',   label: 'Earth Obs',   color: '#36D977' },
  { id: 'navigation',  label: 'Navigation',  color: '#00FF88' },
  { id: 'geo',         label: 'GEO',         color: '#FFD700' },
  { id: 'sarsat',      label: 'SARSAT',      color: '#FF9500' },
  { id: 'relay',       label: 'Relay',       color: '#A78BFA' },
  { id: 'comms',       label: 'Comms',       color: '#00D4FF' },
  { id: 'amateur',     label: 'Amateur',     color: '#F472B6' },
  { id: 'science',     label: 'Science',     color: '#FFD700' },
  { id: 'military',    label: 'Military',    color: '#D97736' },
  { id: 'engineering', label: 'Engineering', color: '#9CA3AF' },
]

export function SatellitePanel() {
  const activeLayers = useStore((s) => s.activeLayers)
  const showSatProjections = useStore((s) => s.showSatProjections)
  const toggleSatProjections = useStore((s) => s.toggleSatProjections)
  const showSatOrbits = useStore((s) => s.showSatOrbits)
  const toggleSatOrbits = useStore((s) => s.toggleSatOrbits)
  const hiddenSatCatalogs = useStore((s) => s.hiddenSatCatalogs)
  const toggleSatCatalog = useStore((s) => s.toggleSatCatalog)
  const setAllSatCatalogs = useStore((s) => s.setAllSatCatalogs)

  if (!activeLayers.includes('satellites')) return null

  const allVisible = hiddenSatCatalogs.size === 0
  const noneVisible = hiddenSatCatalogs.size === SAT_CATALOGS.length

  return (
    <div className="glass-panel mt-2 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-worldview-border">
        <span className="text-[9px] font-bold tracking-widest text-[#D4A017]">
          SATELLITES
        </span>
      </div>

      {/* Projection Cones Toggle */}
      <div className="px-3 py-2 border-b border-worldview-border/50">
        <div
          className="flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
          onClick={toggleSatProjections}
        >
          <span className="text-[8px] text-[#888888] tracking-wider">PROJECTION CONES</span>
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
            style={{ backgroundColor: showSatProjections ? '#D4A017' : '#2A2A2A' }}
          />
        </div>
      </div>

      {/* Orbital Paths Toggle */}
      <div className="px-3 py-2 border-b border-worldview-border/50">
        <div
          className="flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
          onClick={toggleSatOrbits}
        >
          <span className="text-[8px] text-[#888888] tracking-wider">ORBITAL PATHS</span>
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
            style={{ backgroundColor: showSatOrbits ? '#D4A017' : '#2A2A2A' }}
          />
        </div>
      </div>

      {/* Catalog Filters */}
      <div className="px-3 py-2 border-b border-worldview-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase">FILTERS</span>
          <button
            onClick={() => setAllSatCatalogs(noneVisible || !allVisible)}
            className="text-[7px] text-[#555555] hover:text-worldview-cyan transition-colors tracking-wider"
          >
            {allVisible ? 'NONE' : 'ALL'}
          </button>
        </div>
        <div className="space-y-0.5">
          {SAT_CATALOGS.map((cat) => {
            const visible = !hiddenSatCatalogs.has(cat.id)
            return (
              <div
                key={cat.id}
                className="flex items-center justify-between py-0.5 cursor-pointer hover:bg-white/5 transition-colors group"
                onClick={() => toggleSatCatalog(cat.id)}
              >
                <span className={`text-[8px] tracking-wider transition-colors ${
                  visible ? 'text-[#999999]' : 'text-[#333333]'
                }`}>
                  {cat.label.toUpperCase()}
                </span>
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                  style={{ backgroundColor: visible ? cat.color : '#2A2A2A' }}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Satellite Lookup */}
      <SatelliteLookup onSelect={(noradId) => {
        useStore.getState().setTrackedEntity({ type: 'satellite', key: noradId })
      }} />
    </div>
  )
}
