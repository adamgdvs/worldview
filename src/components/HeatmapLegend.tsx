import { useState } from 'react'
import { useStore } from '../store'

interface LegendEntry {
  label: string
  color: string
}

interface LegendConfig {
  title: string
  entries: LegendEntry[]
}

const AQ_LEGEND: LegendConfig = {
  title: 'AIR QUALITY INDEX',
  entries: [
    { label: '0–50 Good',               color: '#36D977' },
    { label: '51–100 Moderate',          color: '#D4A017' },
    { label: '101–150 Sensitive',        color: '#D97736' },
    { label: '151–200 Unhealthy',        color: '#DD4444' },
    { label: '201–300 Very Unhealthy',   color: '#9966FF' },
    { label: '301–500 Hazardous',        color: '#7E0023' },
  ],
}

const WX_LEGEND: LegendConfig = {
  title: 'PRECIPITATION',
  entries: [
    { label: 'Light Rain / Drizzle',  color: '#77DD77' },
    { label: 'Light–Moderate Rain',   color: '#229922' },
    { label: 'Moderate Rain',         color: '#FFFF33' },
    { label: 'Heavy Rain',            color: '#FFAA22' },
    { label: 'Very Heavy / Freezing', color: '#FF3333' },
    { label: 'Severe Thunderstorm',   color: '#DD44DD' },
    { label: 'Snow / Ice',            color: '#BBCCFF' },
  ],
}

const GPS_LEGEND: LegendConfig = {
  title: 'GPS INTERFERENCE',
  entries: [
    { label: 'Low',       color: '#33FF33' },
    { label: 'Moderate',  color: '#FFFF33' },
    { label: 'High',      color: '#FF6633' },
    { label: 'Severe',    color: '#FF3333' },
  ],
}

function LegendBlock({ config }: { config: LegendConfig }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[8px] font-bold tracking-[0.15em] text-worldview-text-dim mb-1">
        {config.title}
      </div>
      <div className="flex flex-col gap-[2px]">
        {config.entries.map((e) => (
          <div key={e.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: e.color, opacity: 0.9 }}
            />
            <span className="text-[9px] font-mono text-worldview-text-bright/80 leading-tight">
              {e.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Legend for the heatmap layers (air quality / precipitation / GPS jamming).
 * Rendered as a section inside the left sidebar so it never overlaps
 * floating HUD elements.
 */
export function HeatmapLegend() {
  const activeLayers = useStore((s) => s.activeLayers)
  const [collapsed, setCollapsed] = useState(false)

  const showAq  = activeLayers.includes('airq')
  const showWx  = activeLayers.includes('weather')
  const showGps = activeLayers.includes('gpsjam')

  if (!showAq && !showWx && !showGps) return null

  return (
    <div className="px-3 py-2 border-b border-[#2A2A2A]">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left cursor-pointer mb-1.5"
      >
        <span className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase">LEGEND</span>
        <span className="text-[8px] text-[#555555] ml-auto">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div>
          {showAq  && <LegendBlock config={AQ_LEGEND} />}
          {showWx  && <LegendBlock config={WX_LEGEND} />}
          {showGps && <LegendBlock config={GPS_LEGEND} />}
        </div>
      )}
    </div>
  )
}
