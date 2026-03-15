import { useState } from 'react'
import { useStore } from '../store'
import { CollapsibleSection } from './ui/CollapsibleSection'

const locations = [
  'Global', 'Austin', 'San Francisco', 'New York', 'Tokyo',
  'London', 'Paris', 'Dubai', 'Washington DC', 'Hong Kong', 'Singapore',
]

export function LocationsBar() {
  const selectedCity = useStore((s) => s.selectedCity)
  const setCity = useStore((s) => s.setCity)
  const cleanUI = useStore((s) => s.cleanUI)
  const [searchQuery, setSearchQuery] = useState('')

  if (cleanUI) return null

  const handleSearch = () => {
    const q = searchQuery.trim()
    if (!q) return
    setCity(q)
    setSearchQuery('')
  }

  return (
    <div className="absolute bottom-[80px] left-1/2 -translate-x-1/2 z-20 pointer-events-auto w-full max-w-2xl px-8">
      <div className="overflow-hidden">
        <CollapsibleSection id="locations" title="LOCATIONS">
          <div className="px-2 pb-2">
            {/* Current location readout */}
            <div className="px-2 pb-2 space-y-0.5">
              <div className="text-[9px] text-[#4a6385] font-mono">
                📍 Location: <span className="text-worldview-text-bright">{selectedCity || '--'}</span>
              </div>
              <div className="text-[9px] text-[#4a6385] font-mono">
                &nbsp;&nbsp; Landmark: <span className="text-[#5a7a9a]">--</span>
              </div>
            </div>

            {/* Address search */}
            <div className="flex gap-1 px-2 pb-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search address or place..."
                className="flex-1 bg-[#0a1628] border border-worldview-border/40 text-[9px] text-worldview-text-bright px-2 py-1 font-mono placeholder:text-[#304c78] focus:border-worldview-cyan/50 focus:outline-none transition-colors min-w-0"
              />
              <button
                onClick={handleSearch}
                className="px-2 py-1 border border-worldview-cyan/30 text-[8px] text-worldview-cyan font-bold tracking-wider hover:bg-worldview-cyan/10 transition-colors shrink-0"
              >
                GO
              </button>
            </div>

            {/* City pills */}
            <div className="flex flex-wrap gap-1 px-1">
              {locations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setCity(loc)}
                  className={`px-3 py-1 text-[9px] font-bold transition-all rounded-full whitespace-nowrap ${
                    selectedCity === loc
                      ? 'text-worldview-cyan bg-worldview-cyan/10 border border-worldview-cyan/30'
                      : 'text-[#4a6385] hover:text-[#a1bde0] hover:bg-white/5 border border-worldview-border/40'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  )
}
