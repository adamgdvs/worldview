import { useRef, type MutableRefObject } from 'react'
// @ts-ignore
import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium'
import { useStore, type Scene } from '../store'

interface ScenesPanelProps {
  viewerRef: MutableRefObject<Viewer | null>
}

export function ScenesPanel({ viewerRef }: ScenesPanelProps) {
  const scenes = useStore((s) => s.scenes)
  const activeSceneIdx = useStore((s) => s.activeSceneIdx)
  const captureScene = useStore((s) => s.captureScene)
  const loadScene = useStore((s) => s.loadScene)
  const deleteScene = useStore((s) => s.deleteScene)
  const activeLayers = useStore((s) => s.activeLayers)
  const activeMode = useStore((s) => s.activeMode)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCapture = () => {
    const viewer = viewerRef.current
    if (!viewer) return

    const cam = viewer.camera
    const carto = cam.positionCartographic

    const scene: Scene = {
      id: crypto.randomUUID(),
      name: `Shot ${scenes.length + 1}`,
      lon: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
      height: carto.height,
      heading: CesiumMath.toDegrees(cam.heading),
      pitch: CesiumMath.toDegrees(cam.pitch),
      roll: CesiumMath.toDegrees(cam.roll),
      mode: activeMode,
      layers: [...activeLayers],
      createdAt: Date.now(),
    }

    captureScene(scene)
  }

  const handleLoad = (idx: number) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const s = scenes[idx]
    if (!s) return

    loadScene(idx)
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(s.lon, s.lat, s.height),
      orientation: {
        heading: CesiumMath.toRadians(s.heading),
        pitch: CesiumMath.toRadians(s.pitch),
        roll: CesiumMath.toRadians(s.roll),
      },
      duration: 2,
    })
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(scenes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'worldview-scenes.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as Scene[]
        if (Array.isArray(imported)) {
          for (const s of imported) {
            captureScene(s)
          }
        }
      } catch {
        console.warn('[Scenes] Failed to parse import file')
      }
    }
    reader.readAsText(file)
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="px-3 py-3 space-y-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <select
          value={activeSceneIdx ?? ''}
          onChange={(e) => {
            const val = e.target.value
            if (val !== '') handleLoad(Number(val))
          }}
          className="flex-1 bg-[#0a1628] border border-worldview-border/30 text-[8px] text-worldview-text-bright px-2 py-1 font-mono"
        >
          <option value="">Select scene...</option>
          {scenes.map((s, i) => (
            <option key={s.id} value={i}>{s.name}</option>
          ))}
        </select>
        <button
          onClick={handleCapture}
          className="px-2 py-1 border border-[#00f0ff]/30 text-[8px] text-[#00f0ff] font-bold tracking-wider hover:bg-[#00f0ff]/10 transition-colors"
        >
          NEW
        </button>
      </div>

      {/* Capture shot button */}
      <button
        onClick={handleCapture}
        className="w-full px-2 py-1.5 border border-[#D97736]/30 text-[8px] text-[#D97736] font-bold tracking-[2px] hover:bg-[#D97736]/10 transition-colors"
      >
        CAPTURE SHOT
      </button>

      {/* Shot list */}
      {scenes.length > 0 && (
        <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
          {scenes.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center justify-between px-2 py-1 rounded text-[8px] font-mono ${
                activeSceneIdx === i
                  ? 'bg-[#D97736]/10 border border-[#D97736]/30'
                  : 'border border-transparent hover:border-worldview-border/20'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-worldview-text-bright truncate">{s.name}</div>
                <div className="text-[7px] text-[#4a6385]">
                  {s.mode} · {s.layers.length} layers
                </div>
              </div>
              <div className="flex gap-1 ml-2">
                <button
                  onClick={() => handleLoad(i)}
                  className="px-1.5 py-0.5 text-[7px] text-[#00f0ff] border border-[#00f0ff]/20 hover:bg-[#00f0ff]/10"
                >
                  LOAD
                </button>
                <button
                  onClick={() => deleteScene(i)}
                  className="px-1.5 py-0.5 text-[7px] text-[#DD4444] border border-[#DD4444]/20 hover:bg-[#DD4444]/10"
                >
                  DEL
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Export / Import */}
      {scenes.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 px-2 py-1 border border-worldview-border/30 text-[8px] text-[#5a7a9a] font-bold tracking-wider hover:text-worldview-text-bright transition-colors"
          >
            EXPORT
          </button>
          <label className="flex-1 px-2 py-1 border border-worldview-border/30 text-[8px] text-[#5a7a9a] font-bold tracking-wider hover:text-worldview-text-bright transition-colors text-center cursor-pointer">
            IMPORT
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>
        </div>
      )}

      {scenes.length === 0 && (
        <div className="text-center">
          <span className="text-[8px] text-[#304c78] tracking-widest">NO SCENES CAPTURED</span>
        </div>
      )}
    </div>
  )
}
