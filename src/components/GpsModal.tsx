import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'

interface GpsModalProps {
  onNavigate: (lat: number, lon: number, alt?: number) => void
}

export function GpsModal({ onNavigate }: GpsModalProps) {
  const open = useStore((s) => s.gpsModalOpen)
  const setOpen = useStore((s) => s.setGpsModalOpen)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setInput('')
      setError('')
      // Focus input after mount
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseCoordinates(input.trim())
    if (!parsed) {
      setError('Invalid format. Use: lat, lon  or  lat, lon, alt')
      return
    }
    onNavigate(parsed.lat, parsed.lon, parsed.alt)
    setOpen(false)
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />

      {/* Modal */}
      <div className="relative glass-panel w-96 p-4">
        <div className="text-[9px] text-[#666666] font-bold tracking-[2px] uppercase mb-3">
          GPS COORDINATE JUMP
        </div>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError('') }}
            placeholder="lat, lon  (e.g. 38.9072, -77.0369)"
            className="w-full bg-[#111111] border border-worldview-border text-worldview-text-bright text-[11px] font-mono px-3 py-2 placeholder:text-[#333333] focus:border-worldview-cyan/50 focus:outline-none transition-colors"
          />

          {error && (
            <div className="text-worldview-red text-[9px] mt-1.5 font-mono">{error}</div>
          )}

          <div className="flex items-center justify-between mt-3">
            <div className="text-[8px] text-[#333333] font-mono">
              Formats: 38.9, -77.0 | 38.9, -77.0, 1500
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-[9px] font-bold tracking-wider text-[#666666] border border-worldview-border hover:text-worldview-text-bright hover:border-worldview-text-bright transition-colors"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-[9px] font-bold tracking-wider text-worldview-cyan border border-worldview-cyan/40 bg-worldview-cyan/5 hover:bg-worldview-cyan/15 transition-colors"
              >
                FLY TO
              </button>
            </div>
          </div>
        </form>

        <div className="mt-3 pt-2 border-t border-worldview-border/30">
          <div className="text-[8px] text-[#333333] font-mono tracking-wider">
            SHORTCUT: <span className="text-[#666666]">G</span> to open/close
          </div>
        </div>
      </div>
    </div>
  )
}

function parseCoordinates(input: string): { lat: number; lon: number; alt?: number } | null {
  // Strip common decorators
  const cleaned = input.replace(/[°NSEW]/gi, '').trim()

  // Split by comma, space, or semicolon
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean).map(Number)

  if (parts.length < 2 || parts.some(isNaN)) return null

  const [lat, lon, alt] = parts
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

  return { lat, lon, alt: alt != null && alt > 0 ? alt : undefined }
}
