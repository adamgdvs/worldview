import { useStore } from '../store'

const modes = [
  { id: 'Normal', icon: '○',  label: 'Normal' },
  { id: 'CRT',    icon: '▦',  label: 'CRT'    },
  { id: 'NVG',    icon: '☽',  label: 'NVG'    },
  { id: 'FLIR',   icon: '♨',  label: 'FLIR'   },
  { id: 'Anime',  icon: '✦',  label: 'Anime'  },
  { id: 'Noir',   icon: '◑',  label: 'Noir'   },
  { id: 'Snow',   icon: '❄',  label: 'Snow'   },
  { id: 'AI',     icon: '⊛',  label: 'AI'     },
]

export function StylePresetsBar() {
  const activeMode = useStore((s) => s.activeMode)
  const setMode = useStore((s) => s.setMode)
  const cleanUI = useStore((s) => s.cleanUI)

  if (cleanUI) return null

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex flex-col items-center">
      {/* Mode circles */}
      <div className="flex items-center gap-1.5 p-1.5">
        {modes.map((mode) => {
          const isActive = activeMode === mode.id
          return (
            <button
              key={mode.id}
              onClick={() => setMode(mode.id)}
              className="flex flex-col items-center gap-1 group"
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-base transition-all ${
                  isActive
                    ? 'border-2 border-worldview-cyan bg-worldview-cyan/10 shadow-[0_0_12px_rgba(0,240,255,0.25)] text-worldview-cyan'
                    : 'border border-worldview-border/40 text-[#4a6385] hover:border-[#5a7a9a] hover:text-[#6A8BAF] hover:bg-white/5'
                }`}
              >
                {mode.icon}
              </div>
              <span
                className={`text-[7px] font-bold tracking-wider transition-colors ${
                  isActive ? 'text-worldview-cyan' : 'text-[#4a6385] group-hover:text-[#6A8BAF]'
                }`}
              >
                {mode.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
