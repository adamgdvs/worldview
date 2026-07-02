import { type MutableRefObject } from 'react'
// @ts-ignore
import type { Viewer } from 'cesium'
import { useStore, type AviationFilter, type ShaderParams } from '../store'
import { Plane, Satellite, Activity, Ship, Flame, Wind, Radio, Map, Shield, Car, Camera } from 'lucide-react'
// SatelliteLookup moved to SatellitePanel
import { ScenesPanel } from './ScenesPanel'
import { Slider } from './ui/Slider'
import { HeatmapLegend } from './HeatmapLegend'

// ─── Data layers (grouped with visual separators) ────────────────────────────
const LAYER_GROUPS = [
  // Air
  [
    { id: 'avi-civil',   label: 'LIVE FLIGHTS',  icon: Plane,     color: '#00F0FF' },
    { id: 'avi-mil',     label: 'MILITARY',      icon: Plane,     color: '#D97736' },
    { id: 'satellites',  label: 'SATELLITES',     icon: Satellite, color: '#D4A017' },
  ],
  // Sea
  [
    { id: 'maritime',    label: 'AIS VESSELS',    icon: Ship,      color: '#36D977' },
  ],
  // Ground & Environment
  [
    { id: 'seismic',     label: 'SEISMIC',        icon: Activity,  color: '#D97736' },
    { id: 'fires',       label: 'FIRES',          icon: Flame,     color: '#FF6B2B' },
    { id: 'airq',        label: 'AIR QUALITY',    icon: Wind,      color: '#9966FF' },
    { id: 'weather',     label: 'WEATHER',        icon: Radio,     color: '#6699FF' },
    { id: 'gpsjam',      label: 'GPS JAMMING',    icon: Shield,    color: '#FF3333' },
    { id: 'traffic',     label: 'TRAFFIC',        icon: Car,       color: '#36D977' },
    { id: 'cctv',        label: 'CCTV FEEDS',     icon: Camera,    color: '#00F0FF' },
  ],
  // Imagery
  [
    { id: 'nightlights', label: 'NIGHT LIGHTS',   icon: Map,       color: '#FFD700' },
  ],
] as const

// ─── Aviation filters ────────────────────────────────────────────────────────
const AVIATION_CATEGORIES: { id: AviationFilter; label: string; color: string }[] = [
  { id: 'civil',      label: 'Civil',      color: '#00F0FF' },
  { id: 'military',   label: 'Military',   color: '#D97736' },
  { id: 'helicopter', label: 'Helicopter', color: '#A78BFA' },
  { id: 'uav',        label: 'UAV',        color: '#F472B6' },
  { id: 'unknown',    label: 'Unknown',    color: '#6B7280' },
]

// ─── Mode-specific slider config ─────────────────────────────────────────────
function getModeSliders(mode: string): Array<{ label: string; key: keyof ShaderParams }> {
  switch (mode) {
    case 'Normal':
      return []
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

export function SidebarLeft({ viewerRef }: { viewerRef: MutableRefObject<Viewer | null> }) {
  const cleanUI = useStore((s) => s.cleanUI)
  const { activeLayers, toggleLayer } = useStore()
  const layerLoading = useStore((s) => s.layerLoading)
  const layerError = useStore((s) => s.layerError)
  const activeMode = useStore((s) => s.activeMode)
  const shaderParams = useStore((s) => s.shaderParams)
  const setShaderParam = useStore((s) => s.setShaderParam)
  const aviationFilters = useStore((s) => s.aviationFilters)
  const toggleAviationFilter = useStore((s) => s.toggleAviationFilter)
  const setAllAviationFilters = useStore((s) => s.setAllAviationFilters)
  const trafficDensity = useStore((s) => s.trafficDensity)
  const setTrafficDensity = useStore((s) => s.setTrafficDensity)
  const showLabels = useStore((s) => s.showLabels)
  const toggleLabels = useStore((s) => s.toggleLabels)
  const hudLayout = useStore((s) => s.hudLayout)
  const setHudLayout = useStore((s) => s.setHudLayout)
  const toggleCleanUI = useStore((s) => s.toggleCleanUI)
  const terrainExaggeration = useStore((s) => s.terrainExaggeration)
  const setTerrainExaggeration = useStore((s) => s.setTerrainExaggeration)
  const bloomIntensity = useStore((s) => s.bloomIntensity)
  const setBloomIntensity = useStore((s) => s.setBloomIntensity)
  const pixelateSize = useStore((s) => s.pixelateSize)
  const setPixelateSize = useStore((s) => s.setPixelateSize)
  const sharpenIntensity = useStore((s) => s.sharpenIntensity)
  const setSharpenIntensity = useStore((s) => s.setSharpenIntensity)
  const globeViewMode = useStore((s) => s.globeViewMode)
  const toggleGlobeViewMode = useStore((s) => s.toggleGlobeViewMode)
  const setCity = useStore((s) => s.setCity)
  const selectedCity = useStore((s) => s.selectedCity)

  const modeSliders = getModeSliders(activeMode)
  const showAviationFilters = activeLayers.includes('avi-civil') || activeLayers.includes('avi-mil')

  if (cleanUI) return null

  return (
    <div className="absolute top-[50%] -translate-y-1/2 left-3 z-20 pointer-events-auto w-[200px] flex flex-col max-h-[75vh]">
      <div className="glass-panel overflow-hidden flex flex-col max-h-full">
        {/* ── Header ── */}
        <div className="px-3 py-2 border-b border-[#2A2A2A] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] text-worldview-text-bright font-bold tracking-[2px] uppercase">Operations</span>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1">
          {/* ── DATA LAYERS ── */}
          <div className="px-3 py-2 border-b border-[#2A2A2A]">
            <div className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase mb-1.5">DATA LAYERS</div>
            {LAYER_GROUPS.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-2 pt-1.5 border-t border-[#222222]' : ''}>
                {group.map((layer) => {
                  const active = activeLayers.includes(layer.id)
                  const loading = active && !!layerLoading[layer.id]
                  const error = active && layerError[layer.id]
                  const Icon = layer.icon
                  return (
                    <button
                      key={layer.id}
                      className="flex items-center justify-between py-[3px] w-full text-left cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => toggleLayer(layer.id)}
                      aria-pressed={active}
                      title={error || undefined}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon size={10} className={active ? 'text-[#999999]' : 'text-[#333333]'} />
                        <span className={`text-[9px] tracking-wider ${active ? 'text-worldview-text-bright' : 'text-[#555555]'}`}>
                          {layer.label}
                        </span>
                      </div>
                      {loading ? (
                        <span className="flex items-center gap-1">
                          <span className="text-[7px] text-amber-400 tracking-wider font-bold animate-pulse">LOADING</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                        </span>
                      ) : error ? (
                        <span className="flex items-center gap-1">
                          <span className="text-[7px] text-red-400 tracking-wider font-bold">ERROR</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        </span>
                      ) : (
                        <div
                          className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                          style={{ backgroundColor: active ? layer.color : '#2A2A2A' }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* ── FLIGHT FILTERS (conditional) ── */}
          {showAviationFilters && (
            <div className="px-3 py-2 border-b border-[#2A2A2A]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase">FLIGHT FILTERS</span>
                <button
                  onClick={() => setAllAviationFilters(aviationFilters.size < 5)}
                  className="text-[7px] text-[#666666] hover:text-worldview-cyan font-mono tracking-wider transition-colors"
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
                          : 'border-worldview-border/30 text-[#333333]'
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

          {/* Satellite controls moved to SatellitePanel (right sidebar) */}

          {/* ── TRAFFIC DENSITY (conditional) ── */}
          {activeLayers.includes('traffic') && (
            <div className="px-3 py-2 border-b border-[#2A2A2A]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase">TRAFFIC DENSITY</span>
                <span className="text-[7px] text-[#666666] font-mono">{Math.round(trafficDensity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(trafficDensity * 100)}
                onChange={(e) => setTrafficDensity(Number(e.target.value) / 100)}
                className="w-full h-1 bg-[#2A2A2A] rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#36D977]
                  [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(54,217,119,0.6)]"
              />
            </div>
          )}

          {/* ── HEATMAP LEGEND (conditional — airq/weather/gpsjam) ── */}
          <HeatmapLegend />

          {/* ── SHADER PARAMS (conditional — only for non-Normal modes) ── */}
          {modeSliders.length > 0 && (
            <div className="px-3 py-2 border-b border-[#2A2A2A]">
              <div className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase mb-1.5">
                {activeMode.toUpperCase()} PARAMS
              </div>
              <div className="space-y-2">
                {modeSliders.map((s) => (
                  <Slider
                    key={s.key}
                    label={s.label}
                    value={shaderParams[s.key]}
                    onChange={(v) => setShaderParam(s.key, v)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── EFFECTS (independent post-processing) ── */}
          <div className="px-3 py-2 border-b border-[#2A2A2A]">
            <div className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase mb-1.5">EFFECTS</div>
            <div className="space-y-2">
              <Slider
                label="Bloom"
                value={bloomIntensity}
                onChange={setBloomIntensity}
              />
              <Slider
                label="Pixelate"
                value={pixelateSize}
                onChange={setPixelateSize}
              />
              <Slider
                label="Sharpen"
                value={sharpenIntensity}
                onChange={setSharpenIntensity}
              />
            </div>
          </div>

          {/* ── DISPLAY (compact footer) ── */}
          <div className="px-3 py-2 border-b border-[#2A2A2A]">
            <div className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase mb-1.5">DISPLAY</div>
            <div className="flex items-center justify-between py-0.5 cursor-pointer hover:bg-white/5 transition-colors" onClick={toggleLabels}>
              <span className="text-[8px] text-[#555555] tracking-wider">Labels</span>
              <div className={`w-5 h-2.5 rounded-full relative transition-colors ${showLabels ? 'bg-worldview-cyan' : 'bg-[#2A2A2A]'}`}>
                <div className={`absolute top-0.5 w-1.5 h-1.5 rounded-full bg-worldview-bg transition-all ${showLabels ? 'left-3' : 'left-0.5'}`} />
              </div>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[8px] text-[#555555] tracking-wider">HUD</span>
              <select
                value={hudLayout}
                onChange={(e) => setHudLayout(e.target.value as any)}
                className="bg-[#111111] border border-worldview-border/40 text-[7px] text-worldview-text-bright px-1.5 py-0.5 font-mono tracking-wider appearance-none cursor-pointer hover:border-worldview-cyan/50 transition-colors"
              >
                <option value="Tactical">Tactical</option>
                <option value="Minimal">Minimal</option>
                <option value="Full">Full</option>
              </select>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[8px] text-[#555555] tracking-wider">Terrain</span>
              <div className="flex gap-0.5">
                {[1, 2, 4].map((level) => (
                  <button
                    key={level}
                    onClick={() => setTerrainExaggeration(level)}
                    className={`px-1.5 py-0.5 text-[7px] font-bold tracking-wider border transition-all ${
                      terrainExaggeration === level
                        ? 'border-worldview-cyan text-worldview-cyan bg-worldview-cyan/10'
                        : 'border-worldview-border/30 text-[#555555] hover:text-[#999999] hover:border-[#666666]'
                    }`}
                  >
                    {level}x
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[8px] text-[#555555] tracking-wider">Globe View</span>
              <div className="flex gap-0.5">
                {(['nadir', 'oblique'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      if (globeViewMode !== mode) toggleGlobeViewMode()
                      if (selectedCity !== 'Global') setCity('Global')
                    }}
                    className={`px-1.5 py-0.5 text-[7px] font-bold tracking-wider border transition-all ${
                      globeViewMode === mode
                        ? 'border-worldview-cyan text-worldview-cyan bg-worldview-cyan/10'
                        : 'border-worldview-border/30 text-[#555555] hover:text-[#999999] hover:border-[#666666]'
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={toggleCleanUI}
              className="mt-1 w-full py-1 text-[8px] text-[#666666] font-bold tracking-[1.5px] uppercase hover:bg-white/5 hover:text-worldview-text-bright transition-colors border border-worldview-border/20"
            >
              CLEAN UI
            </button>
          </div>

          {/* ── SCENES ── */}
          <div className="px-3 py-2">
            <div className="text-[7px] text-[#666666] font-bold tracking-[2px] uppercase mb-1.5">SCENES</div>
            <ScenesPanel viewerRef={viewerRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
