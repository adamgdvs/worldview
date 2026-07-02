import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'

interface SelectedEntity {
  type: 'flight' | 'vessel' | 'seismic' | 'satellite' | 'wildfire' | 'cctv'
  data: any
}

interface TrackedEntity {
  type: 'flight' | 'vessel' | 'satellite'
  key: string  // icao24 for flights, mmsi for vessels, sat id for satellites
}

export interface Scene {
  id: string
  name: string
  lon: number
  lat: number
  height: number
  heading: number
  pitch: number
  roll: number
  mode: string
  layers: string[]
  createdAt: number
}

export type CameraPreset = 'FLAT' | 'SPIRAL_IN' | 'SPIRAL_OUT'

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
  selectedLandmark: string | null
  _citySeq: number
  alertCount: number
  selectedEntity: SelectedEntity | null
  trackedEntity: TrackedEntity | null
  shaderParams: ShaderParams
  hudLayout: HudLayout
  cleanUI: boolean
  showLabels: boolean
  gpsModalOpen: boolean
  aviationFilters: Set<AviationFilter>
  bloomIntensity: number
  pixelateSize: number
  sharpenIntensity: number
  terrainExaggeration: number
  setTerrainExaggeration: (level: number) => void
  setBloomIntensity: (v: number) => void
  setPixelateSize: (v: number) => void
  setSharpenIntensity: (v: number) => void
  trafficDensity: number
  trafficMaxParticles: number
  cameraBbox: [number, number, number, number] | null  // [south, west, north, east]
  cameraHeight: number
  cursorGeo: { lat: number; lon: number } | null
  selectedCameraId: string | null
  cctvCountryFilter: string
  sectionCollapsed: Record<string, boolean>
  layerLoading: Record<string, boolean>
  layerError: Record<string, string>
  setLayerLoading: (layerId: string, loading: boolean) => void
  setLayerError: (layerId: string, error: string | null) => void
  // Playback state
  playbackMode: boolean
  playbackPlaying: boolean
  playbackTime: number          // virtual "now" (Unix ms)
  playbackSpeed: number         // ms sim-time per real second
  playbackRange: [number, number]  // [start, end] Unix ms
  playbackOrbit: boolean
  showPlaybackTrails: boolean
  showSatProjections: boolean
  showSatOrbits: boolean
  hiddenSatCatalogs: Set<string>
  globeViewMode: 'nadir' | 'oblique'
  cameraPreset: CameraPreset
  cameraDistance: number        // km
  cameraPitch: number           // degrees
  cameraFov: number             // degrees
  scenes: Scene[]
  activeSceneIdx: number | null
  setSelectedCameraId: (id: string | null) => void
  setCctvCountryFilter: (filter: string) => void
  toggleLayer: (layerId: string) => void
  setMode: (mode: string) => void
  setCity: (city: string) => void
  setLandmark: (name: string | null) => void
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
  setCameraBbox: (bbox: [number, number, number, number] | null, height: number) => void
  setCursorGeo: (geo: { lat: number; lon: number } | null) => void
  toggleSection: (id: string) => void
  // Playback actions
  setPlaybackMode: (on: boolean) => void
  togglePlayback: () => void
  seekPlayback: (time: number) => void
  setPlaybackRange: (range: [number, number]) => void
  togglePlaybackTrails: () => void
  toggleSatProjections: () => void
  toggleSatOrbits: () => void
  toggleSatCatalog: (catalog: string) => void
  setAllSatCatalogs: (visible: boolean) => void
  toggleGlobeViewMode: () => void
  setPlaybackSpeed: (speed: number) => void
  setPlaybackOrbit: (on: boolean) => void
  setCameraPreset: (preset: CameraPreset) => void
  setCameraDistance: (km: number) => void
  setCameraPitchAngle: (deg: number) => void
  setCameraFov: (deg: number) => void
  captureScene: (scene: Scene) => void
  loadScene: (idx: number) => void
  deleteScene: (idx: number) => void
  updateScene: (idx: number, patch: Partial<Scene>) => void
}

// ── Persistence config ──────────────────────────────────────────────────────
// Only these keys are saved to localStorage. Ephemeral state (playback,
// selected entity, camera bbox, loading flags, etc.) resets on reload.
const PERSISTED_KEYS: (keyof WorldviewState)[] = [
  'activeLayers',
  'activeMode',
  'shaderParams',
  'hudLayout',
  'showLabels',
  'aviationFilters',
  'bloomIntensity',
  'pixelateSize',
  'sharpenIntensity',
  'terrainExaggeration',
  'trafficDensity',
  'trafficMaxParticles',
  'sectionCollapsed',
  'showSatProjections',
  'showSatOrbits',
  'hiddenSatCatalogs',
  'globeViewMode',
  'scenes',
]

// Custom storage handles Set<AviationFilter> ↔ array serialization
const worldviewStorage = {
  getItem: (name: string): StorageValue<WorldviewState> | null => {
    const raw = localStorage.getItem(name)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as StorageValue<any>
      // Rehydrate aviationFilters from array → Set
      if (parsed.state?.aviationFilters && Array.isArray(parsed.state.aviationFilters)) {
        parsed.state.aviationFilters = new Set(parsed.state.aviationFilters)
      }
      if (parsed.state?.hiddenSatCatalogs && Array.isArray(parsed.state.hiddenSatCatalogs)) {
        parsed.state.hiddenSatCatalogs = new Set(parsed.state.hiddenSatCatalogs)
      }
      return parsed
    } catch {
      return null
    }
  },
  setItem: (name: string, value: StorageValue<WorldviewState>) => {
    // Serialize aviationFilters from Set → array
    const serializable = {
      ...value,
      state: {
        ...value.state,
        aviationFilters: value.state.aviationFilters instanceof Set
          ? Array.from(value.state.aviationFilters)
          : value.state.aviationFilters,
        hiddenSatCatalogs: value.state.hiddenSatCatalogs instanceof Set
          ? Array.from(value.state.hiddenSatCatalogs)
          : value.state.hiddenSatCatalogs,
      },
    }
    localStorage.setItem(name, JSON.stringify(serializable))
  },
  removeItem: (name: string) => localStorage.removeItem(name),
}

export const useStore = create<WorldviewState>()(
  persist(
    (set) => ({
      activeLayers: [],
      activeMode: 'CRT',
      selectedCity: 'Global',
      selectedLandmark: null,
      _citySeq: 0,
      alertCount: 7,
      selectedEntity: null,
      trackedEntity: null,
      shaderParams: { bloom: 100, sharpen: 34, scanlines: 50, grain: 50, distortion: 45, vignette: 70 },
      hudLayout: 'Tactical',
      cleanUI: false,
      showLabels: true,
      gpsModalOpen: false,
      aviationFilters: new Set<AviationFilter>(['civil', 'military', 'helicopter', 'uav', 'unknown']),
      bloomIntensity: 0,
      pixelateSize: 0,
      sharpenIntensity: 0,
      terrainExaggeration: 1,
      setTerrainExaggeration: (level) => set({ terrainExaggeration: level }),
      setBloomIntensity: (v) => set({ bloomIntensity: v }),
      setPixelateSize: (v) => set({ pixelateSize: v }),
      setSharpenIntensity: (v) => set({ sharpenIntensity: v }),
      trafficDensity: 0.5,
      trafficMaxParticles: 800,
      cameraBbox: null,
      cameraHeight: 25_000_000,
      cursorGeo: null,
      selectedCameraId: null,
      cctvCountryFilter: 'ALL',
      sectionCollapsed: { 'scenes': true },
      layerLoading: {},
      layerError: {},
      setLayerLoading: (layerId, loading) => set((state) => ({
        layerLoading: { ...state.layerLoading, [layerId]: loading },
      })),
      setLayerError: (layerId, error) => set((state) => {
        if (error === null) {
          const next = { ...state.layerError }
          delete next[layerId]
          return { layerError: next }
        }
        return { layerError: { ...state.layerError, [layerId]: error } }
      }),
      // Playback initial state
      playbackMode: false,
      playbackPlaying: false,
      playbackTime: Date.now(),
      playbackSpeed: 60_000,
      playbackRange: [Date.now() - 3_600_000, Date.now()] as [number, number],
      playbackOrbit: false,
      showPlaybackTrails: true,
      showSatProjections: false,
      showSatOrbits: false,
      hiddenSatCatalogs: new Set<string>(),
      globeViewMode: 'nadir' as 'nadir' | 'oblique',
      cameraPreset: 'FLAT' as CameraPreset,
      cameraDistance: 250,
      cameraPitch: -45,
      cameraFov: 60,
      scenes: [],
      activeSceneIdx: null,
      setSelectedCameraId: (id) => set({ selectedCameraId: id }),
      setCctvCountryFilter: (filter) => set({ cctvCountryFilter: filter }),
      toggleLayer: (layerId: string) => set((state) => ({
        activeLayers: state.activeLayers.includes(layerId)
          ? state.activeLayers.filter((id) => id !== layerId)
          : [...state.activeLayers, layerId]
      })),
      setMode: (mode: string) => set({ activeMode: mode }),
      setCity: (city: string) => set({ selectedCity: city, selectedLandmark: null, _citySeq: Date.now() }),
      setLandmark: (name) => set({ selectedLandmark: name }),
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
      setCameraBbox: (bbox, height) => set({ cameraBbox: bbox, cameraHeight: height }),
      setCursorGeo: (geo) => set({ cursorGeo: geo }),
      toggleSection: (id) => set((state) => ({
        sectionCollapsed: { ...state.sectionCollapsed, [id]: !state.sectionCollapsed[id] },
      })),
      // Playback actions
      setPlaybackMode: (on) => set(() => {
        const now = Date.now()
        if (on) {
          return {
            playbackMode: true,
            playbackPlaying: false,
            playbackTime: now - 3_600_000,
            playbackRange: [now - 3_600_000, now] as [number, number],
          }
        }
        return {
          playbackMode: false,
          playbackPlaying: false,
          playbackOrbit: false,
          activeSceneIdx: null,
        }
      }),
      togglePlayback: () => set((state) => ({ playbackPlaying: !state.playbackPlaying })),
      seekPlayback: (time) => set((state) => ({
        playbackTime: Math.max(state.playbackRange[0], Math.min(time, state.playbackRange[1])),
      })),
      setPlaybackRange: (range) => set({ playbackRange: range, playbackTime: range[0] }),
      togglePlaybackTrails: () => set((state) => ({ showPlaybackTrails: !state.showPlaybackTrails })),
      toggleSatProjections: () => set((state) => ({ showSatProjections: !state.showSatProjections })),
      toggleSatOrbits: () => set((state) => ({ showSatOrbits: !state.showSatOrbits })),
      toggleSatCatalog: (catalog) => set((state) => {
        const next = new Set(state.hiddenSatCatalogs)
        if (next.has(catalog)) next.delete(catalog)
        else next.add(catalog)
        return { hiddenSatCatalogs: next }
      }),
      setAllSatCatalogs: (visible) => set({
        hiddenSatCatalogs: visible ? new Set<string>() : new Set<string>([
          'notable', 'stations', 'visual', 'weather', 'earth-obs', 'navigation',
          'geo', 'sarsat', 'relay', 'comms', 'amateur', 'science', 'military', 'engineering',
        ]),
      }),
      toggleGlobeViewMode: () => set((state) => ({
        globeViewMode: state.globeViewMode === 'nadir' ? 'oblique' : 'nadir',
      })),
      setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
      setPlaybackOrbit: (on) => set({ playbackOrbit: on }),
      setCameraPreset: (preset) => set({ cameraPreset: preset }),
      setCameraDistance: (km) => set({ cameraDistance: km }),
      setCameraPitchAngle: (deg) => set({ cameraPitch: deg }),
      setCameraFov: (deg) => set({ cameraFov: deg }),
      captureScene: (scene) => set((state) => ({
        scenes: [...state.scenes, scene],
        activeSceneIdx: state.scenes.length,
      })),
      loadScene: (idx) => set({ activeSceneIdx: idx }),
      deleteScene: (idx) => set((state) => {
        const scenes = state.scenes.filter((_, i) => i !== idx)
        const activeSceneIdx = state.activeSceneIdx === idx ? null
          : state.activeSceneIdx !== null && state.activeSceneIdx > idx
            ? state.activeSceneIdx - 1
            : state.activeSceneIdx
        return { scenes, activeSceneIdx }
      }),
      updateScene: (idx, patch) => set((state) => ({
        scenes: state.scenes.map((s, i) => i === idx ? { ...s, ...patch } : s),
      })),
    }),
    {
      name: 'worldview-prefs',
      version: 1,
      storage: worldviewStorage,
      partialize: (state) => {
        const partial: Record<string, any> = {}
        for (const key of PERSISTED_KEYS) {
          partial[key] = state[key]
        }
        return partial as WorldviewState
      },
    },
  )
)
