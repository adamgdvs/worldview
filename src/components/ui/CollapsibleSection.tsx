import { useStore } from '../../store'

interface CollapsibleSectionProps {
  id: string
  title: string
  children: React.ReactNode
  standalone?: boolean  // renders as its own bordered box
}

export function CollapsibleSection({ id, title, children, standalone }: CollapsibleSectionProps) {
  const collapsed = useStore((s) => s.sectionCollapsed[id] ?? false)
  const toggleSection = useStore((s) => s.toggleSection)

  if (standalone) {
    return (
      <div className="glass-panel overflow-hidden">
        <button
          onClick={() => toggleSection(id)}
          className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-white/5 transition-colors"
        >
          <span className="text-[9px] text-[#5a7a9a] font-bold tracking-[2px] uppercase">{title}</span>
          <span className="text-[10px] text-[#5a7a9a] font-mono">
            {collapsed ? '+' : '−'}
          </span>
        </button>
        {!collapsed && <div>{children}</div>}
      </div>
    )
  }

  return (
    <div className="border-b border-worldview-border/50">
      <button
        onClick={() => toggleSection(id)}
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <span className="text-[9px] text-[#5a7a9a] font-bold tracking-[2px] uppercase">{title}</span>
        <span className="text-[9px] text-[#5a7a9a] font-mono">
          {collapsed ? '(+)' : '(-)'}
        </span>
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  )
}
