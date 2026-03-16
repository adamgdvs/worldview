import { create } from 'zustand'

interface SelectedEntity {
  type: 'flight' | 'vessel' | 'seismic' | 'satellite' | 'wildfire' | 'cctv'
  data: any
}

interface TrackedEntity {
  type: 'flight' | 'vessel' | 'satellite'
  key: string  // icao24 for flights, mmsi for vessels, sat id for satellites
}

export interface ShaderParams {
  bloom: number
  sharpen: number
  scanlines: number
  grain: number
  distortion: number
  vignette: number
}

export type HudLayout = 'Tactical' | 'Minimal' | 'Full'
export type AviationFilter = 'civil' | 'military' | 'helicopter' | 'uav' | 'unknown'

interface WorldviewState {
  activeLayers: string[]
  activeMode: string
  selectedCity: string
  alertCount: number
  selectedEntity: SelectedEntity | null
  trackedEntity: TrackedEntity | null
  shaderParams: ShaderParams
  hudLayout: HudLayout
  cleanUI: boolean
  showLabels: boolean
  gpsModalOpen: boolean
  aviationFilters: Set<AviationFilter>
  trafficDensity: number
  trafficMaxParticles: number
  sectionCollapsed: Record<string, boolean>
  toggleLayer: (layerId: string) => void
  setMode: (mode: string) => void
  setCity: (city: string) => void
  setSelectedEntity: (entity: SelectedEntity | null) => void
  setTrackedEntity: (entity: TrackedEntity | null) => void
  setShaderParam: (key: keyof ShaderParams, value: number) => void
  setHudLayout: (layout: HudLayout) => void
  toggleCleanUI: () => void
  toggleLabels: () => void
  setGpsModalOpen: (open: boolean) => void
  toggleAviationFilter: (filter: AviationFilter) => void
  setAllAviationFilters: (on: boolean) => void
  setTrafficDensity: (d: number) => void
  setTrafficMaxParticles: (n: number) => void
  toggleSection: (id: string) => void
}

export const useStore = create<WorldviewState>((set) => ({
  activeLayers: ['avi-civil', 'maritime', 'satellites', 'seismic', 'fires'],
  activeMode: 'CRT',
  selectedCity: 'Global',
  alertCount: 7,
  selectedEntity: null,
  trackedEntity: null,
  shaderParams: { bloom: 100, sharpen: 34, scanlines: 50, grain: 50, distortion: 45, vignette: 70 },
  hudLayout: 'Tactical',
  cleanUI: false,
  showLabels: true,
  gpsModalOpen: false,
  aviationFilters: new Set<AviationFilter>(['civil', 'military', 'helicopter', 'uav', 'unknown']),
  trafficDensity: 0.5,
  trafficMaxParticles: 800,
  sectionCollapsed: { 'scenes': true },
  toggleLayer: (layerId: string) => set((state) => ({
    activeLayers: state.activeLayers.includes(layerId)
      ? state.activeLayers.filter((id) => id !== layerId)
      : [...state.activeLayers, layerId]
  })),
  setMode: (mode: string) => set({ activeMode: mode }),
  setCity: (city: string) => set({ selectedCity: city }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setTrackedEntity: (entity) => set({ trackedEntity: entity }),
  setShaderParam: (key, value) => set((state) => ({
    shaderParams: { ...state.shaderParams, [key]: value },
  })),
  setHudLayout: (layout) => set({ hudLayout: layout }),
  toggleCleanUI: () => set((state) => ({ cleanUI: !state.cleanUI })),
  toggleLabels: () => set((state) => ({ showLabels: !state.showLabels })),
  setGpsModalOpen: (open) => set({ gpsModalOpen: open }),
  toggleAviationFilter: (filter) => set((state) => {
    const next = new Set(state.aviationFilters)
    if (next.has(filter)) next.delete(filter)
    else next.add(filter)
    return { aviationFilters: next }
  }),
  setAllAviationFilters: (on) => set({
    aviationFilters: on
      ? new Set<AviationFilter>(['civil', 'military', 'helicopter', 'uav', 'unknown'])
      : new Set<AviationFilter>(),
  }),
  setTrafficDensity: (d) => set({ trafficDensity: d }),
  setTrafficMaxParticles: (n) => set({ trafficMaxParticles: n }),
  toggleSection: (id) => set((state) => ({
    sectionCollapsed: { ...state.sectionCollapsed, [id]: !state.sectionCollapsed[id] },
  })),
}))
