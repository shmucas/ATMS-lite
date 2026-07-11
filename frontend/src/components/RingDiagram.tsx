import clsx from 'clsx'
import type { IntersectionInfo, Phase, Snapshot } from '../types'

/* Signal colors are domain-semantic: a red ball is red. Deliberately not from
   the abstract categorical palette. */
const FILL: Record<Phase['signal'], string> = {
  green: '#10d982',
  yellow: '#f5c518',
  red: '#ff5a5a',
  dark: '#2b3a4f',
}

const PED_TEXT: Record<Phase['ped'], { t: string; c: string }> = {
  walk: { t: 'WALK', c: '#10d982' },
  ped_clear: { t: 'FDW', c: '#f5c518' },
  dont_walk: { t: 'DW', c: 'var(--color-ink-3)' },
  dark: { t: '', c: 'transparent' },
}

interface Props {
  snapshot: Snapshot
  info: IntersectionInfo
  onPhaseClick?: (phase: number) => void
  armed?: boolean
}

function PhaseCell({
  p,
  clickable,
  onClick,
}: {
  p: Phase
  clickable: boolean
  onClick?: () => void
}) {
  const serving = p.on
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      title={clickable ? `Place a vehicle call on phase ${p.phase}` : `Phase ${p.phase}`}
      className={clsx(
        'relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border py-2 transition-all',
        serving
          ? 'border-[var(--color-line-strong)] bg-[var(--color-panel-2)]'
          : 'border-[var(--color-line)] bg-[var(--color-panel)]/40',
        p.signal === 'dark' && 'opacity-40',
        clickable
          ? 'cursor-pointer hover:border-[var(--color-accent)] hover:bg-[var(--color-panel-2)]'
          : 'cursor-default',
      )}
    >
      {p.next && (
        <span className="absolute -top-1.5 rounded-full bg-[var(--color-accent)] px-1.5 text-[9px] font-bold text-black">
          NEXT
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span
          className="h-3.5 w-3.5 rounded-full"
          style={{
            background: FILL[p.signal],
            boxShadow: p.signal !== 'dark' ? `0 0 8px 1px ${FILL[p.signal]}88` : undefined,
          }}
        />
        <span
          className={clsx(
            'text-sm font-semibold',
            serving ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-2)]',
          )}
        >
          {'Φ'}
          {p.phase}
        </span>
      </div>
      <div className="flex h-3 items-center gap-1">
        {PED_TEXT[p.ped].t && (
          <span
            className="text-[9px] font-bold"
            style={{ color: PED_TEXT[p.ped].c }}
          >
            {PED_TEXT[p.ped].t}
          </span>
        )}
        {p.veh_call && (
          <span className="rounded bg-[var(--color-accent)]/25 px-1 text-[9px] font-bold text-[var(--color-accent)]">
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
}

export function RingDiagram({ snapshot, info, onPhaseClick, armed }: Props) {
  const rings = info.static?.rings ?? []
  const barriers = info.static?.barriers ?? []
  const byPhase = new Map(snapshot.phases.map((p) => [p.phase, p]))

  if (rings.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-ink-3)]">
        Ring configuration not available from this controller.
      </div>
    )
  }

  const columns: number[][] = barriers.length > 0 ? barriers : [[]]

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        Ring &amp; barrier {armed && <span className="ml-1 text-[var(--color-degraded)]">· control live</span>}
      </h3>
      <div className="flex gap-1.5">
        <div className="flex w-10 flex-col justify-around pt-5">
          {rings.map((r) => (
            <div
              key={r.ring}
              className="flex h-14 items-center text-[11px] font-semibold text-[var(--color-ink-3)]"
            >
              R{r.ring}
            </div>
          ))}
        </div>
        <div className="flex flex-1 gap-0">
          {columns.map((barrier, bi) => (
            <div
              key={bi}
              className={clsx(
                'flex-1 px-1.5',
                bi < columns.length - 1 &&
                  'border-r-2 border-dashed border-[var(--color-line-strong)]',
              )}
            >
              <div className="pb-1 text-center text-[9px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Barrier {bi + 1}
              </div>
              {rings.map((r) => {
                const cells = r.phases.filter((p) => barrier.includes(p))
                return (
                  <div key={r.ring} className="flex h-14 items-center gap-1.5">
                    {cells.map((num) => {
                      const p = byPhase.get(num)
                      if (!p) return null
                      return (
                        <PhaseCell
                          key={num}
                          p={p}
                          clickable={!!onPhaseClick}
                          onClick={() => onPhaseClick?.(num)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-ink-3)]">
        <Dot c={FILL.green} l="green" />
        <Dot c={FILL.yellow} l="yellow" />
        <Dot c={FILL.red} l="red" />
        <span>V vehicle call</span>
        <span>P ped call</span>
      </div>
    </section>
  )
}

function Dot({ c, l }: { c: string; l: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
      {l}
    </span>
  )
}
