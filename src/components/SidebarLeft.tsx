import { useStore, type AviationFilter } from '../store'
import { Plane, Satellite, Activity, Ship, Flame, Wind, Radio, Map, Shield, Car, Camera, Tag } from 'lucide-react'
import { CollapsibleSection } from './ui/CollapsibleSection'
import { SatelliteLookup } from './SatelliteLookup'

const AVIATION_CATEGORIES: { id: AviationFilter; label: string; color: string }[] = [
  { id: 'civil',      label: 'Civil',      color: '#00F0FF' },
  { id: 'military',   label: 'Military',   color: '#D97736' },
  { id: 'helicopter', label: 'Helicopter', color: '#A78BFA' },
  { id: 'uav',        label: 'UAV',        color: '#F472B6' },
  { id: 'unknown',    label: 'Unknown',    color: '#6B7280' },
]

export function SidebarLeft() {
  const { activeLayers, toggleLayer } = useStore()
  const cleanUI = useStore((s) => s.cleanUI)
  const aviationFilters = useStore((s) => s.aviationFilters)
  const toggleAviationFilter = useStore((s) => s.toggleAviationFilter)
  const setAllAviationFilters = useStore((s) => s.setAllAviationFilters)
  const trafficDensity = useStore((s) => s.trafficDensity)
  const setTrafficDensity = useStore((s) => s.setTrafficDensity)
  const showLabels = useStore((s) => s.showLabels)
  const toggleLabels = useStore((s) => s.toggleLabels)

  if (cleanUI) return null

  return (
    <div className="absolute top-[50%] -translate-y-1/2 left-3 z-20 pointer-events-auto w-[200px] flex flex-col gap-2 max-h-[75vh]">
      {/* DATA LAYERS */}
      <CollapsibleSection id="data-layers" title="DATA LAYERS" standalone>
        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
          <LayerSection title="AVIATION">
            <LayerRow
              label="Civil ADS-B"
              icon={<Plane size={12} />}
              color="#00F0FF"
              active={activeLayers.includes('avi-civil')}
              onToggle={() => toggleLayer('avi-civil')}
            />
            <LayerRow
              label="Military"
              icon={<Plane size={12} />}
              color="#D97736"
              active={activeLayers.includes('avi-mil')}
              onToggle={() => toggleLayer('avi-mil')}
            />
            <LayerRow
              label="Satellites"
              icon={<Satellite size={12} />}
              color="#D4A017"
              active={activeLayers.includes('satellites')}
              onToggle={() => toggleLayer('satellites')}
            />

            {/* Satellite lookup — visible when satellite layer is on */}
            {activeLayers.includes('satellites') && (
              <SatelliteLookup onSelect={(noradId) => {
                useStore.getState().setTrackedEntity({ type: 'satellite', key: noradId })
              }} />
            )}

            {/* Aviation category filter */}
            {(activeLayers.includes('avi-civil') || activeLayers.includes('avi-mil')) && (
              <div className="px-3 py-1.5 border-t border-worldview-border/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[7px] text-[#4a6a8a] font-bold tracking-[1.5px] uppercase">FILTER</span>
                  <button
                    onClick={() => setAllAviationFilters(aviationFilters.size < 5)}
                    className="text-[7px] text-[#5a7a9a] hover:text-worldview-cyan font-mono tracking-wider transition-colors"
                  >
                    {aviationFilters.size === 5 ? 'NONE' : 'ALL'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {AVIATION_CATEGORIES.map((cat) => {
                    const active = aviationFilters.has(cat.id)
                    return (
                      <button
                        key={cat.id}
                        onClick={() => toggleAviationFilter(cat.id)}
                        className={`px-1.5 py-0.5 text-[7px] font-bold tracking-wider border transition-all ${
                          active
                            ? 'border-current bg-current/10'
                            : 'border-worldview-border/30 text-[#304c78]'
                        }`}
                        style={active ? { color: cat.color, borderColor: cat.color, backgroundColor: `${cat.color}15` } : undefined}
                      >
                        {cat.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </LayerSection>

          <LayerSection title="MARITIME">
            <LayerRow
              label="AIS Vessels"
              icon={<Ship size={12} />}
              color="#36D977"
              active={activeLayers.includes('maritime')}
              onToggle={() => toggleLayer('maritime')}
            />
          </LayerSection>

          <LayerSection title="GROUND">
            <LayerRow
              label="Traffic Sim"
              icon={<Car size={12} />}
              color="#36D977"
              active={activeLayers.includes('traffic')}
              onToggle={() => toggleLayer('traffic')}
            />
            {activeLayers.includes('traffic') && (
              <div className="px-3 py-1.5 border-t border-worldview-border/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[6px] font-mono tracking-wider px-1 py-0.5 rounded bg-[#36D977]/15 text-[#36D977] border border-[#36D977]/30">GOOGLE TRAFFIC</span>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[7px] text-[#4a6a8a] font-bold tracking-[1.5px] uppercase">DENSITY</span>
                  <span className="text-[7px] text-[#5a7a9a] font-mono">{Math.round(trafficDensity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(trafficDensity * 100)}
                  onChange={(e) => setTrafficDensity(Number(e.target.value) / 100)}
                  className="w-full h-1 bg-worldview-border/30 appearance-none cursor-pointer accent-[#36D977]"
                />
              </div>
            )}
            <LayerRow
              label="Seismic"
              icon={<Activity size={12} />}
              color="#D97736"
              active={activeLayers.includes('seismic')}
              onToggle={() => toggleLayer('seismic')}
            />
            <LayerRow
              label="Fires"
              icon={<Flame size={12} />}
              color="#FF6B2B"
              active={activeLayers.includes('fires')}
              onToggle={() => toggleLayer('fires')}
            />
            <LayerRow
              label="Air Quality"
              icon={<Wind size={12} />}
              color="#9966FF"
              active={activeLayers.includes('airq')}
              onToggle={() => toggleLayer('airq')}
            />
            <LayerRow
              label="CCTV Cameras"
              icon={<Camera size={12} />}
              color="#00F0FF"
              active={activeLayers.includes('cctv')}
              onToggle={() => toggleLayer('cctv')}
            />
          </LayerSection>

          <LayerSection title="IMAGERY">
            <LayerRow
              label="Weather Radar"
              icon={<Radio size={12} />}
              color="#6699FF"
              active={activeLayers.includes('weather')}
              onToggle={() => toggleLayer('weather')}
            />
            <LayerRow
              label="Night Lights"
              icon={<Map size={12} />}
              color="#FFD700"
              active={activeLayers.includes('nightlights')}
              onToggle={() => toggleLayer('nightlights')}
            />
            <LayerRow
              label="GPS Jamming"
              icon={<Shield size={12} />}
              color="#FF3333"
              active={activeLayers.includes('gpsjam')}
              onToggle={() => toggleLayer('gpsjam')}
            />
          </LayerSection>

          <LayerSection title="DISPLAY">
            <div
              className={`flex items-center justify-between px-3 py-1 cursor-pointer hover:bg-white/5 transition-colors ${showLabels ? 'text-worldview-text-bright' : 'text-worldview-text-main'}`}
              onClick={toggleLabels}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#C8D8E8' }} />
                <span className="text-[#5a7a9a] shrink-0"><Tag size={12} /></span>
                <span className="text-[9px] truncate">Labels</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                <div className={`w-5 h-2.5 rounded-full relative transition-colors ${showLabels ? 'bg-worldview-cyan' : 'bg-[#1E3050]'}`}>
                  <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-worldview-bg transition-all ${showLabels ? 'left-3' : 'left-0.5'}`} />
                </div>
              </div>
            </div>
          </LayerSection>

          {/* Bottom Stats */}
          <div className="px-3 py-2 border-t border-worldview-border/30">
            <StatRow label="ENTITIES" value="18,124" valueClass="text-worldview-cyan" />
            <StatRow label="ALERTS" value="7" valueClass="text-worldview-red" />
          </div>
        </div>
      </CollapsibleSection>

      {/* SCENES */}
      <CollapsibleSection id="scenes" title="SCENES" standalone>
        <div className="px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <select
              disabled
              className="flex-1 bg-[#0a1628] border border-worldview-border/30 text-[8px] text-[#304c78] px-2 py-1 font-mono cursor-not-allowed"
            >
              <option>Select scene...</option>
            </select>
            <button
              disabled
              className="px-2 py-1 border border-worldview-border/30 text-[8px] text-[#304c78] font-bold tracking-wider cursor-not-allowed"
            >
              NEW
            </button>
          </div>
          <div className="text-center">
            <span className="text-[8px] text-[#304c78] tracking-widest">COMING SOON</span>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  )
}

function LayerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-0.5">
      <div className="px-3 py-1 text-[7px] text-[#5a7a9a] font-bold tracking-[2px] uppercase">
        {title}
      </div>
      {children}
    </div>
  )
}

function LayerRow({ label, icon, count, color, active, onToggle }: {
  label: string
  icon: React.ReactNode
  count?: string
  color: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-1 cursor-pointer hover:bg-white/5 transition-colors ${active ? 'text-worldview-text-bright' : 'text-worldview-text-main'}`}
      onClick={onToggle}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {icon && <span className="text-[#5a7a9a] shrink-0">{icon}</span>}
        <span className="text-[9px] truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-1">
        {count && <span className="text-[7px] font-mono text-[#5a7a9a]">{count}</span>}
        <div className={`w-5 h-2.5 rounded-full relative transition-colors ${active ? 'bg-worldview-cyan' : 'bg-[#1E3050]'}`}>
          <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-worldview-bg transition-all ${active ? 'left-3' : 'left-0.5'}`} />
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex justify-between items-center py-0.5 text-[8px] font-mono">
      <span className="text-[#5a7a9a]">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
