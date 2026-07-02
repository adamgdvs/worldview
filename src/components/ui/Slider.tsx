interface SliderProps {
  label: string
  value: number
  onChange?: (v: number) => void
  min?: number
  max?: number
}

export function Slider({ label, value, onChange, min = 0, max = 100 }: SliderProps) {
  return (
    <div>
      {label && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-[8px] text-[#555555] tracking-widest font-bold uppercase">{label}</span>
          <span className="text-[8px] text-worldview-cyan font-mono">{Math.round(value)}%</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-full h-1 bg-[#2A2A2A] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-worldview-cyan
          [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,240,255,0.6)]"
      />
    </div>
  )
}
