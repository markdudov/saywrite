import { MAX_LEVELS } from './state'

export function Waveform({ levels }: { levels: number[] }): React.JSX.Element {
  const padded = [...Array<number>(MAX_LEVELS - levels.length).fill(0), ...levels]
  return (
    <div className="flex h-6 items-center gap-[2px]" aria-hidden>
      {padded.map((l, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-white/90"
          style={{ height: `${Math.max(12, Math.round(l * 100))}%` }}
        />
      ))}
    </div>
  )
}
