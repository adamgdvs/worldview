import { useState, useEffect } from 'react'

export function Topbar() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatUTC = (date: Date) => {
    return date.toISOString().slice(11, 19)
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-auto flex flex-col">
      <div className="h-9 bg-[#060b16]/90 border-b border-worldview-border backdrop-blur-sm flex items-center px-4 gap-4">
        <div className="text-worldview-cyan font-bold tracking-[0.3em] text-sm shrink-0">
          W O R L D V I E W
        </div>
        
        <div className="flex gap-2 overflow-hidden items-center">
          <StatusPill label="AIS LIVE" status="live" />
          <StatusPill label="ADSB" status="live" />
          <StatusPill label="FIRMS DELAYED" status="warn" />
          <StatusPill label="23 LAYERS ACTIVE" status="info" />
        </div>
        
        <div className="ml-auto flex items-center gap-2 text-worldview-text-main text-[11px] font-mono">
          <span>UTC</span>
          <span className="text-worldview-cyan">{formatUTC(time)}</span>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ label, status }: { label: string, status: 'live' | 'warn' | 'info' }) {
  const styles = {
    live: 'bg-green-500/10 text-worldview-green border-green-500/30',
    warn: 'bg-orange-500/10 text-worldview-orange border-orange-500/30',
    info: 'bg-worldview-cyan/10 text-worldview-cyan border-worldview-cyan/20'
  }

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-xs border text-[9px] font-bold tracking-wider ${styles[status]}`}>
      {status === 'live' && <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </div>
  )
}
