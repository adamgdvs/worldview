import { useStore } from '../store'

export function LivePlaybackToggle() {
  const playbackMode = useStore((s) => s.playbackMode)
  const setPlaybackMode = useStore((s) => s.setPlaybackMode)

  return (
    <div className="absolute top-3 right-[220px] z-30 pointer-events-auto flex">
      <button
        onClick={() => setPlaybackMode(false)}
        className={`px-3 py-1 text-[9px] font-bold tracking-[2px] font-mono border border-worldview-border/30 rounded-l transition-colors ${
          !playbackMode
            ? 'bg-[#00f0ff]/20 text-[#00f0ff] border-[#00f0ff]/40'
            : 'bg-[#111111]/80 text-[#555555] hover:text-[#666666]'
        }`}
      >
        LIVE
      </button>
      <button
        onClick={() => setPlaybackMode(true)}
        className={`px-3 py-1 text-[9px] font-bold tracking-[2px] font-mono border border-worldview-border/30 border-l-0 rounded-r transition-colors ${
          playbackMode
            ? 'bg-[#D97736]/20 text-[#D97736] border-[#D97736]/40'
            : 'bg-[#111111]/80 text-[#555555] hover:text-[#666666]'
        }`}
      >
        PLAYBACK
      </button>
    </div>
  )
}
