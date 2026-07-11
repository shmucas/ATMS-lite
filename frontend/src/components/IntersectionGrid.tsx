import clsx from 'clsx'
import type { StreamState } from '../lib/stream'
import type { Phase, Snapshot } from '../types'
import { ConnectionBadge } from './ui'

const DOT: Record<Phase['signal'], string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
  dark: 'bg-slate-700',
}

function MiniRing({ snapshot }: { snapshot: Snapshot }) {
  const phases = snapshot.phases.slice(0, 8)
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {phases.map((p) => (
        <div key={p.phase} className="flex items-center gap-1">
          <span className={clsx('h-2.5 w-2.5 rounded-full', DOT[p.signal])} />
          <span className="text-[10px] text-slate-500">{p.phase}</span>
        </div>
      ))}
    </div>
  )
}

export function IntersectionGrid(props: {
  stream: StreamState
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { stream, selected, onSelect } = props
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stream.intersections.map((ix) => {
        const snap = stream.snapshots[ix.id]
        const greens = snap
          ? snap.phases.filter((p) => p.signal === 'green').map((p) => p.phase)
          : []
        const armed = stream.control[ix.id]?.armed
        return (
          <button
            key={ix.id}
            onClick={() => onSelect(ix.id)}
            className={clsx(
              'rounded-xl border bg-slate-900/60 p-3 text-left transition-colors',
              selected === ix.id
                ? 'border-sky-500/60 ring-1 ring-sky-500/40'
                : 'border-slate-800 hover:border-slate-700',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100">
                  {ix.name}
                </div>
                <div className="text-[10px] text-slate-500">
                  {snap ? `serving ${greens.join(', ') || '--'}` : 'no data'}
                </div>
              </div>
              <ConnectionBadge state={ix.connection} />
            </div>
            <div className="mt-3">
              {snap ? (
                <MiniRing snapshot={snap} />
              ) : (
                <div className="h-6 text-xs text-slate-600">waiting...</div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
              <span>
                {snap?.coord?.avg_cycle
                  ? `${snap.coord.avg_cycle.toFixed(0)}s cycle`
                  : 'cycle --'}
              </span>
              {armed && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-400">
                  ARMED
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
