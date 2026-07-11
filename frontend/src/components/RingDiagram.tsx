import clsx from 'clsx'
import type { IntersectionInfo, Phase, Snapshot } from '../types'

/* Signal colors are domain-semantic: a red ball is red. They are deliberately
   not drawn from the abstract categorical palette. */
const FILL: Record<Phase['signal'], string> = {
  green: '#10b981',
  yellow: '#fbbf24',
  red: '#ef4444',
  dark: '#334155',
}

const PED_TEXT: Record<Phase['ped'], string> = {
  walk: 'WALK',
  ped_clear: 'FDW',
  dont_walk: 'DW',
  dark: '',
}

interface Props {
  snapshot: Snapshot
  info: IntersectionInfo
  onPhaseClick?: (phase: number) => void
  armed?: boolean
}

export function RingDiagram({ snapshot, info, onPhaseClick, armed }: Props) {
  const rings = info.static?.rings ?? []
  const barriers = info.static?.barriers ?? []
  const byPhase = new Map(snapshot.phases.map((p) => [p.phase, p]))

  if (rings.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-500">
        Ring configuration not available from this controller.
      </div>
    )
  }

  /* Column order comes from the barriers the controller reported, so the
     diagram matches the real intersection rather than a textbook layout. */
  const columns: number[][] = barriers.length > 0 ? barriers : [[]]

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {/* Ring labels column */}
        <div className="flex w-12 flex-col justify-around pt-6">
          {rings.map((r) => (
            <div
              key={r.ring}
              className="flex h-16 items-center text-xs font-semibold text-slate-500"
            >
              Ring {r.ring}
            </div>
          ))}
        </div>

        <div className="flex flex-1 gap-0">
          {columns.map((barrier, bi) => (
            <div
              key={bi}
              className={clsx(
                'flex-1 px-2',
                bi < columns.length - 1 && 'border-r-2 border-dashed border-slate-700',
              )}
            >
              <div className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Barrier {bi + 1}
              </div>
              {rings.map((r) => {
                const cells = r.phases.filter((p) => barrier.includes(p))
                return (
                  <div key={r.ring} className="flex h-16 items-center gap-2">
                    {cells.map((phaseNum) => {
                      const p = byPhase.get(phaseNum)
                      if (!p) return null
                      const serving = p.on
                      return (
                        <button
                          key={phaseNum}
                          type="button"
                          disabled={!onPhaseClick}
                          onClick={() => onPhaseClick?.(phaseNum)}
                          title={
                            onPhaseClick
                              ? `Place a vehicle call on phase ${phaseNum}`
                              : `Phase ${phaseNum}`
                          }
                          className={clsx(
                            'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border py-2 transition-all',
                            serving
                              ? 'border-slate-600 bg-slate-800/80'
                              : 'border-slate-800 bg-slate-900/40',
                            p.signal === 'dark' && 'opacity-40',
                            onPhaseClick &&
                              'cursor-pointer hover:border-sky-500 hover:bg-slate-800',
                            !onPhaseClick && 'cursor-default',
                            armed && onPhaseClick && 'hover:ring-2 hover:ring-sky-500/40',
                          )}
                        >
                          {p.next && (
                            <span className="absolute -top-1.5 rounded-full bg-sky-500 px-1.5 text-[9px] font-bold text-white">
                              NEXT
                            </span>
                          )}
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-3.5 w-3.5 rounded-full"
                              style={{
                                background: FILL[p.signal],
                                boxShadow:
                                  p.signal !== 'dark'
                                    ? `0 0 10px 1px ${FILL[p.signal]}88`
                                    : undefined,
                              }}
                            />
                            <span
                              className={clsx(
                                'text-sm font-semibold',
                                serving ? 'text-slate-100' : 'text-slate-400',
                              )}
                            >
                              {'Φ'}
                              {phaseNum}
                            </span>
                          </div>
                          <div className="flex h-3 items-center gap-1">
                            {PED_TEXT[p.ped] && (
                              <span
                                className={clsx(
                                  'text-[9px] font-bold',
                                  p.ped === 'walk' && 'text-emerald-400',
                                  p.ped === 'ped_clear' && 'text-amber-400',
                                  p.ped === 'dont_walk' && 'text-slate-600',
                                )}
                              >
                                {PED_TEXT[p.ped]}
                              </span>
                            )}
                            {p.veh_call && (
                              <span className="rounded bg-sky-500/25 px-1 text-[9px] font-bold text-sky-300">
                                V
                              </span>
                            )}
                            {p.ped_call && (
                              <span className="rounded bg-violet-500/25 px-1 text-[9px] font-bold text-violet-300">
                                P
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 px-2 pt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: FILL.green }} />
          green
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: FILL.yellow }} />
          yellow
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: FILL.red }} />
          red
        </span>
        <span>V = vehicle call</span>
        <span>P = ped call</span>
        <span>barrier = dashed divider</span>
      </div>
    </div>
  )
}
