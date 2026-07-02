import { useRef, useCallback, useState } from 'react'
import { Play, Pause, Eye, EyeOff } from 'lucide-react'
import { useStore, type CameraPreset } from '../store'

const SPEED_OPTIONS: { label: string; value: number }[] = [
  { label: '1m/s',  value: 60_000 },
  { label: '3m/s',  value: 180_000 },
  { label: '5m/s',  value: 300_000 },
  { label: '15m/s', value: 900_000 },
  { label: '1h/s',  value: 3_600_000 },
]

const LOCATIONS = [
  'Global', 'Austin', 'San Francisco', 'New York', 'Tokyo',
  'London', 'Paris', 'Dubai', 'Washington DC', 'Hong Kong', 'Singapore',
]

const LAYER_CHIPS = [
  { id: 'avi-civil',   label: 'Commercial Flights' },
  { id: 'avi-mil',     label: 'Military Flights' },
  { id: 'gpsjam',      label: 'GPS Jamming' },
  { id: 'satellites',  label: 'Imaging Satellites' },
  { id: 'maritime',    label: 'Maritime Traffic' },
]

const EVENT_CHIPS = [
  'Kinetic', 'Retaliation', 'Civilian Impact', 'Maritime', 'Infrastructure', 'Escalation',
]

export function PlaybackBar() {
  const playbackPlaying = useStore((s) => s.playbackPlaying)
  const playbackTime = useStore((s) => s.playbackTime)
  const playbackSpeed = useStore((s) => s.playbackSpeed)
  const playbackRange = useStore((s) => s.playbackRange)
  const playbackOrbit = useStore((s) => s.playbackOrbit)
  const cameraPreset = useStore((s) => s.cameraPreset)
  const cameraDistance = useStore((s) => s.cameraDistance)
  const cameraPitch = useStore((s) => s.cameraPitch)
  const cameraFov = useStore((s) => s.cameraFov)
  const selectedCity = useStore((s) => s.selectedCity)
  const activeLayers = useStore((s) => s.activeLayers)
  const showPlaybackTrails = useStore((s) => s.showPlaybackTrails)

  const togglePlayback = useStore((s) => s.togglePlayback)
  const seekPlayback = useStore((s) => s.seekPlayback)
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed)
  const setPlaybackOrbit = useStore((s) => s.setPlaybackOrbit)
  const setCameraPreset = useStore((s) => s.setCameraPreset)
  const setCameraDistance = useStore((s) => s.setCameraDistance)
  const setCameraPitchAngle = useStore((s) => s.setCameraPitchAngle)
  const setCameraFov = useStore((s) => s.setCameraFov)
  const setCity = useStore((s) => s.setCity)
  const toggleLayer = useStore((s) => s.toggleLayer)
  const togglePlaybackTrails = useStore((s) => s.togglePlaybackTrails)

  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const [start, end] = playbackRange
  const progress = end > start ? (playbackTime - start) / (end - start) : 0

  const seekFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seekPlayback(start + pct * (end - start))
  }, [start, end, seekPlayback])

  const handleTrackDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
    seekFromX(e.clientX)

    const onMove = (ev: MouseEvent) => seekFromX(ev.clientX)
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [seekFromX])

  const formatTime = (ms: number) => {
    const d = new Date(ms)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const formatDate = (ms: number) => {
    const d = new Date(ms)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[160px] z-20 pointer-events-auto">
      <div className="h-full bg-[#060e1a]/95 backdrop-blur-sm border-t border-worldview-border/20 px-6 py-3 flex flex-col gap-2">
        {/* Row 1: Transport + Timeline */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlayback}
            className="w-8 h-8 flex items-center justify-center rounded border border-[#D97736]/40 bg-[#D97736]/10 text-[#D97736] hover:bg-[#D97736]/20 transition-colors flex-shrink-0"
          >
            {playbackPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          {/* Trail visibility toggle */}
          <button
            onClick={togglePlaybackTrails}
            className={`w-8 h-8 flex items-center justify-center rounded border transition-colors flex-shrink-0 ${
              showPlaybackTrails
                ? 'border-[#D97736]/40 bg-[#D97736]/10 text-[#D97736] hover:bg-[#D97736]/20'
                : 'border-worldview-border/20 text-[#555555] hover:text-[#666666]'
            }`}
            title={showPlaybackTrails ? 'Hide trails' : 'Show trails'}
          >
            {showPlaybackTrails ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>

          {/* Time display */}
          <div className="flex-shrink-0 text-[9px] font-mono text-[#D97736] w-[80px]">
            <div>{formatDate(playbackTime)}</div>
            <div>{formatTime(playbackTime)}</div>
          </div>

          {/* Timeline track */}
          <div
            ref={trackRef}
            onMouseDown={handleTrackDown}
            className={`flex-1 h-6 relative cursor-pointer group ${dragging ? 'select-none' : ''}`}
          >
            {/* Track background */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-[#1a2a40] rounded-full" />
            {/* Progress fill */}
            <div
              className="absolute top-1/2 -translate-y-1/2 left-0 h-1 bg-[#D97736]/40 rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#D97736] rounded-full border-2 border-[#D97736] shadow-[0_0_6px_rgba(217,119,54,0.5)]"
              style={{ left: `calc(${progress * 100}% - 6px)` }}
            />
          </div>

          {/* Range labels */}
          <div className="flex-shrink-0 text-[8px] font-mono text-[#555555] w-[80px] text-right">
            <div>{formatTime(start)}</div>
            <div>{formatTime(end)}</div>
          </div>

          {/* Speed buttons */}
          <div className="flex gap-1 flex-shrink-0">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPlaybackSpeed(opt.value)}
                className={`px-2 py-1 text-[8px] font-mono font-bold tracking-wider border rounded transition-colors ${
                  playbackSpeed === opt.value
                    ? 'border-[#D97736]/60 bg-[#D97736]/15 text-[#D97736]'
                    : 'border-worldview-border/20 text-[#555555] hover:text-[#666666]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Camera Controls */}
        <div className="flex items-center gap-4">
          {/* Orbit toggle */}
          <button
            onClick={() => setPlaybackOrbit(!playbackOrbit)}
            className={`px-2 py-1 text-[8px] font-mono font-bold tracking-wider border rounded transition-colors ${
              playbackOrbit
                ? 'border-[#D97736]/60 bg-[#D97736]/15 text-[#D97736]'
                : 'border-worldview-border/20 text-[#555555]'
            }`}
          >
            ORBIT: {playbackOrbit ? 'ON' : 'OFF'}
          </button>

          {/* Location dropdown */}
          <select
            value={selectedCity}
            onChange={(e) => setCity(e.target.value)}
            className="bg-[#111111] border border-worldview-border/30 text-[9px] text-worldview-text-bright px-2 py-1 font-mono rounded"
          >
            {LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>

          {/* Camera presets */}
          {(['FLAT', 'SPIRAL_IN', 'SPIRAL_OUT'] as CameraPreset[]).map((preset) => (
            <button
              key={preset}
              onClick={() => setCameraPreset(preset)}
              className={`px-2 py-1 text-[8px] font-mono font-bold tracking-wider border rounded transition-colors ${
                cameraPreset === preset
                  ? 'border-[#D97736]/60 bg-[#D97736]/15 text-[#D97736]'
                  : 'border-worldview-border/20 text-[#555555] hover:text-[#666666]'
              }`}
            >
              {preset.replace('_', ' ')}
            </button>
          ))}

          {/* Distance slider */}
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-[#555555] font-mono">DIST</span>
            <input
              type="range"
              min={50}
              max={500}
              value={cameraDistance}
              onChange={(e) => setCameraDistance(Number(e.target.value))}
              className="w-16 h-1 accent-[#D97736]"
            />
            <span className="text-[8px] text-[#666666] font-mono w-[32px]">{cameraDistance}km</span>
          </div>

          {/* Pitch slider */}
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-[#555555] font-mono">PITCH</span>
            <input
              type="range"
              min={-90}
              max={0}
              value={cameraPitch}
              onChange={(e) => setCameraPitchAngle(Number(e.target.value))}
              className="w-16 h-1 accent-[#D97736]"
            />
            <span className="text-[8px] text-[#666666] font-mono w-[24px]">{cameraPitch}°</span>
          </div>

          {/* FOV slider */}
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-[#555555] font-mono">FOV</span>
            <input
              type="range"
              min={30}
              max={90}
              value={cameraFov}
              onChange={(e) => setCameraFov(Number(e.target.value))}
              className="w-16 h-1 accent-[#D97736]"
            />
            <span className="text-[8px] text-[#666666] font-mono w-[24px]">{cameraFov}°</span>
          </div>
        </div>

        {/* Row 3: Layer + Event Chips */}
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
          {LAYER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              onClick={() => toggleLayer(chip.id)}
              className={`px-2 py-0.5 text-[8px] font-mono font-bold tracking-wider border rounded-full whitespace-nowrap transition-colors ${
                activeLayers.includes(chip.id)
                  ? 'border-[#00f0ff]/40 bg-[#00f0ff]/10 text-[#00f0ff]'
                  : 'border-worldview-border/20 text-[#555555] hover:text-[#666666]'
              }`}
            >
              {chip.label}
            </button>
          ))}

          <div className="w-px h-4 bg-worldview-border/20 flex-shrink-0" />

          {EVENT_CHIPS.map((chip) => (
            <button
              key={chip}
              disabled
              className="px-2 py-0.5 text-[8px] font-mono tracking-wider border border-worldview-border/10 text-[#333333] rounded-full whitespace-nowrap cursor-not-allowed"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
