import { useState, useRef, useEffect } from 'react'
import { searchSatellites, fetchSatelliteById } from '../adapters/satellites'

interface SatelliteLookupProps {
  onSelect: (noradId: string) => void
}

export function SatelliteLookup({ onSelect }: SatelliteLookupProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    // Search locally loaded satellites
    const found = searchSatellites(query)
    setResults(found)
  }, [query])

  const handleFetch = async () => {
    const id = parseInt(query.trim(), 10)
    if (isNaN(id) || id <= 0) {
      setError('Enter a valid NORAD ID')
      return
    }
    setLoading(true)
    setError('')
    const ok = await fetchSatelliteById(id)
    setLoading(false)
    if (ok) {
      onSelect(String(id))
      setQuery('')
      setResults([])
    } else {
      setError('Satellite not found')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (results.length > 0) {
        onSelect(results[0].id)
        setQuery('')
        setResults([])
      } else {
        handleFetch()
      }
    }
  }

  return (
    <div className="px-3 py-2 border-t border-worldview-border/30">
      <div className="text-[7px] text-[#4a6a8a] font-bold tracking-[1.5px] uppercase mb-1">SAT LOOKUP</div>
      <div className="flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError('') }}
          onKeyDown={handleKeyDown}
          placeholder="NORAD ID or name..."
          className="flex-1 bg-[#111111] border border-worldview-border/40 text-[9px] text-worldview-text-bright px-2 py-1 font-mono placeholder:text-[#333333] focus:border-worldview-cyan/50 focus:outline-none transition-colors min-w-0"
        />
        <button
          onClick={handleFetch}
          disabled={loading}
          className="px-2 py-1 border border-worldview-cyan/30 text-[8px] text-worldview-cyan font-bold tracking-wider hover:bg-worldview-cyan/10 transition-colors shrink-0 disabled:opacity-50"
        >
          {loading ? '...' : 'GO'}
        </button>
      </div>
      {error && <div className="text-worldview-red text-[8px] mt-1 font-mono">{error}</div>}
      {results.length > 0 && (
        <div className="mt-1 max-h-24 overflow-y-auto custom-scrollbar">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => { onSelect(r.id); setQuery(''); setResults([]) }}
              className="w-full text-left px-1.5 py-0.5 text-[8px] font-mono text-worldview-text-bright hover:bg-worldview-cyan/10 hover:text-worldview-cyan transition-colors truncate"
            >
              <span className="text-[#666666]">{r.id}</span> {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
