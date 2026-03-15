import { useStore } from '../store'

export function CleanUIToggle() {
  const toggleCleanUI = useStore((s) => s.toggleCleanUI)

  return (
    <button
      onClick={toggleCleanUI}
      className="absolute bottom-6 right-6 z-30 pointer-events-auto px-3 py-2 border border-worldview-cyan/40 bg-[#060b16]/90 backdrop-blur-md text-worldview-cyan text-[10px] font-bold tracking-widest hover:bg-worldview-cyan/10 transition-all"
    >
      SHOW UI
    </button>
  )
}
