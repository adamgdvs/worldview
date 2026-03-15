import { Link2 } from 'lucide-react'
import { useStore } from '../store'

export function HUD() {
  const activeMode = useStore((s) => s.activeMode)
  const hudLayout = useStore((s) => s.hudLayout)
  const cleanUI = useStore((s) => s.cleanUI)

  if (cleanUI) return null

  const utcNow = new Date().toISOString().slice(11, 19) + 'Z'

  return (
    <>
      {/* Center Crosshair — always shown */}
      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
        <div className="relative w-10 h-10 border border-worldview-cyan/30 rounded-sm flex items-center justify-center">
          <div className="w-1 h-1 bg-worldview-cyan rounded-full shadow-[0_0_5px_rgba(0,240,255,1)]" />
          <div className="absolute w-5 h-px bg-worldview-cyan/50 -left-[25px]" />
          <div className="absolute w-5 h-px bg-worldview-cyan/50 -right-[25px]" />
          <div className="absolute h-5 w-px bg-worldview-cyan/50 -top-[25px]" />
          <div className="absolute h-5 w-px bg-worldview-cyan/50 -bottom-[25px]" />
        </div>
      </div>

      {/* Minimal: crosshair + UTC time */}
      {hudLayout === 'Minimal' && (
        <div className="absolute top-3 right-3 z-20 pointer-events-none">
          <div className="text-[11px] text-worldview-cyan font-mono tracking-wider">{utcNow}</div>
        </div>
      )}

      {/* Tactical + Full: branding, classification, stats */}
      {(hudLayout === 'Tactical' || hudLayout === 'Full') && (
        <>
          {/* Top Left Branding/ID — positioned at top of screen */}
          <div className="absolute top-3 left-3 z-20 pointer-events-none">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-4 h-4 rounded-full border border-worldview-cyan/40 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-worldview-cyan rounded-full" />
              </div>
              <h1 className="text-lg font-bold tracking-[0.35em] text-worldview-text-bright">W O R L D V I E W</h1>
            </div>
            <div className="text-[8px] text-[#4a6385] tracking-[0.25em] uppercase ml-6 mb-4">NO PLACE LEFT BEHIND</div>
            <div className="space-y-1">
              <div className="text-worldview-orange font-bold tracking-widest text-[9px]">TOP SECRET // SI-TK // NOFORN</div>
              <div className="text-[#607b9e] text-[9px] flex gap-2 font-mono">
                <span>KH11-4166</span>
                <span>OPS-4117</span>
              </div>
              <div className="text-worldview-cyan font-bold tracking-widest text-[11px] mt-1">{activeMode}</div>
            </div>
          </div>

          {/* Top Center — link icon */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <Link2 className="w-4 h-4 text-[#4a6385] -rotate-45" />
          </div>

          {/* Top Right Stats/Active Mode */}
          <div className="absolute top-3 right-3 z-20 text-right pointer-events-none flex flex-col items-end">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[8px] text-[#4a6385] tracking-widest uppercase">ACTIVE STYLE</span>
            </div>
            <div className="text-glow-cyan font-bold tracking-[0.25em] uppercase text-base mb-3">{activeMode}</div>
            <div className="pr-0 py-1 border-r-2 border-r-worldview-orange pl-4">
              <div className="text-worldview-orange text-[9px] font-bold mb-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-worldview-orange rounded-full animate-pulse" />
                REC {new Date().toISOString().slice(0, 10)} {utcNow}
              </div>
              <div className="text-[#607b9e] text-[8px] tracking-wider uppercase">ORB: 47439 PASS: DESC-179</div>
            </div>
          </div>

          {/* Bottom Left Stats */}
          <div className="absolute bottom-[165px] left-[230px] z-20 pointer-events-none space-y-0.5">
            <div className="text-[9px] text-[#4a6385] font-mono tracking-wider">GSD: 1399.31M NIIRS: <span className="text-worldview-orange">0.0</span></div>
            <div className="text-[9px] text-[#4a6385] font-mono tracking-wider">ALT: 3731487M SUN: <span className="text-worldview-orange">-42.8° EL</span></div>
          </div>

          {/* Bottom Right Stats */}
          <div className="absolute bottom-[165px] right-[230px] z-20 pointer-events-none text-right space-y-0.5">
            <div className="text-[9px] text-[#4a6385] font-mono tracking-wider">GSD: 1399.31M NIIRS: <span className="text-worldview-orange">0.0</span></div>
            <div className="text-[9px] text-[#4a6385] font-mono tracking-wider">ALT: 3731487M SUN: <span className="text-worldview-orange">-42.8° EL</span></div>
          </div>
        </>
      )}

      {/* Full only: camera altitude readout */}
      {hudLayout === 'Full' && (
        <div className="absolute bottom-[165px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="text-[8px] text-[#4a6385] font-mono tracking-wider">
            CAM ALT: <span className="text-worldview-cyan">--</span> |
            LAT: <span className="text-worldview-text-bright">--</span> |
            LON: <span className="text-worldview-text-bright">--</span>
          </div>
        </div>
      )}
    </>
  )
}
