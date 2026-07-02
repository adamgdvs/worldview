import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { LANDMARKS, LANDMARK_KEYS } from '../data/landmarks'
import { CollapsibleSection } from './ui/CollapsibleSection'

const locations = [
  'Global', 'Austin', 'San Francisco', 'New York', 'Tokyo',
  'London', 'Paris', 'Dubai', 'Washington DC', 'Hong Kong', 'Singapore',
]

export function LocationsBar() {
  const selectedCity = useStore((s) => s.selectedCity)
  const selectedLandmark = useStore((s) => s.selectedLandmark)
  const setCity = useStore((s) => s.setCity)
  const setLandmark = useStore((s) => s.setLandmark)
  const cleanUI = useStore((s) => s.cleanUI)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const cityLandmarks = LANDMARKS[selectedCity] ?? null

  // Keyboard shortcuts Q/W/E/R/T/Y for landmarks
  useEffect(() => {
    if (!cityLandmarks) return
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toUpperCase()
      const idx = (LANDMARK_KEYS as readonly string[]).indexOf(key)
      if (idx !== -1 && idx < cityLandmarks.length) {
        e.preventDefault()
        setLandmark(cityLandmarks[idx].name)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cityLandmarks, setLandmark])

  if (cleanUI) return null

  const handleSearch = () => {
    const q = searchQuery.trim()
    if (!q) return
    setCity(q)
    setSearchQuery('')
    setSearchOpen(false)
  }

  return (
    <div className="absolute bottom-[80px] left-1/2 -translate-x-1/2 z-20 pointer-events-auto w-full max-w-2xl px-8">
      <div className="overflow-hidden">
        <CollapsibleSection id="locations" title="LOCATIONS">
          <div className="px-2 pb-2">
            {/* Current location readout */}
            <div className="px-2 pb-2 space-y-0.5">
              <div className="text-[9px] text-[#555555] font-mono">
                📍 Location: <span className="text-worldview-text-bright">{selectedCity || '--'}</span>
              </div>
              <div className="text-[9px] text-[#555555] font-mono">
                &nbsp;&nbsp; Landmark: <span className={selectedLandmark ? 'text-worldview-cyan' : 'text-[#666666]'}>{selectedLandmark ?? '--'}</span>
              </div>
            </div>

            {/* Landmarks pill row — horizontal scroll, no wrap */}
            {cityLandmarks && (
              <div className="overflow-x-auto scrollbar-hide px-1 pb-2">
                <div className="flex gap-1 w-max">
                  {cityLandmarks.map((lm, i) => (
                    <button
                      key={lm.name}
                      onClick={() => setLandmark(lm.name)}
                      className={`px-2 py-0.5 text-[8px] font-bold transition-all rounded-full whitespace-nowrap ${
                        selectedLandmark === lm.name
                          ? 'text-worldview-cyan bg-worldview-cyan/10 border border-worldview-cyan/30'
                          : 'text-[#555555] hover:text-[#a1bde0] hover:bg-white/5 border border-worldview-border/40'
                      }`}
                      title={`${LANDMARK_KEYS[i]} — ${lm.name}`}
                    >
                      <span className="text-[7px] opacity-60 mr-0.5">{LANDMARK_KEYS[i]}</span> {lm.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* City pills + search toggle */}
            <div className="flex flex-wrap gap-1 px-1 items-center">
              {locations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setCity(loc)}
                  className={`px-3 py-1 text-[9px] font-bold transition-all rounded-full whitespace-nowrap ${
                    selectedCity === loc
                      ? 'text-worldview-cyan bg-worldview-cyan/10 border border-worldview-cyan/30'
                      : 'text-[#555555] hover:text-[#a1bde0] hover:bg-white/5 border border-worldview-border/40'
                  }`}
                >
                  {loc}
                </button>
              ))}
              <button
                onClick={() => setCity('Global')}
                className="px-3 py-1 text-[9px] font-bold transition-all rounded-full whitespace-nowrap text-worldview-orange hover:text-worldview-orange hover:bg-worldview-orange/10 border border-worldview-orange/40"
              >
                RESET
              </button>
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className={`px-2 py-1 text-[9px] transition-all rounded-full border ${
                  searchOpen
                    ? 'text-worldview-cyan border-worldview-cyan/30 bg-worldview-cyan/10'
                    : 'text-[#555555] border-worldview-border/40 hover:text-[#a1bde0] hover:bg-white/5'
                }`}
                title="Search address"
              >
                🔍
              </button>
            </div>

            {/* Expandable address search */}
            {searchOpen && (
              <div className="flex gap-1 px-2 pt-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search address or place..."
                  autoFocus
                  className="flex-1 bg-[#111111] border border-worldview-border/40 text-[9px] text-worldview-text-bright px-2 py-1 font-mono placeholder:text-[#333333] focus:border-worldview-cyan/50 focus:outline-none transition-colors min-w-0"
                />
                <button
                  onClick={handleSearch}
                  className="px-2 py-1 border border-worldview-cyan/30 text-[8px] text-worldview-cyan font-bold tracking-wider hover:bg-worldview-cyan/10 transition-colors shrink-0"
                >
                  GO
                </button>
              </div>
            )}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  )
}
