import type { Snapshot } from '../types'

export function CoordMonitor({ snapshot }: { snapshot: Snapshot }) {
  const coord = snapshot.coord
  if (!coord) return null

  const elapsed = coord.cycle_elapsed
  const avg = coord.avg_cycle
  /* This intersection runs actuated, so the cycle is not fixed. The bar shows
     the running cycle against the recent average, clamped, and is explicitly
     labeled as such rather than implying a fixed cycle. */
  const pct =
    elapsed != null && avg != null && avg > 0
      ? Math.min(100, (elapsed / avg) * 100)
      : null

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Item
        label="Pattern"
        value={coord.pattern ?? '--'}
        hint="NTCIP coordPatternStatus"
      />
      <Item
        label="Last cycle"
        value={coord.last_cycle != null ? `${coord.last_cycle.toFixed(0)}s` : '--'}
        hint={
          coord.reference_phase != null
            ? `timed on phase ${coord.reference_phase}`
            : 'measuring'
        }
      />
      <Item
        label="Average cycle"
        value={avg != null ? `${avg.toFixed(0)}s` : '--'}
        hint={
          coord.cycles_seen
            ? `over ${coord.cycles_seen} cycle${coord.cycles_seen === 1 ? '' : 's'}`
            : undefined
        }
      />
      <Item
        label="Into cycle"
        value={elapsed != null ? `${elapsed.toFixed(0)}s` : '--'}
        hint="since the reference phase went green"
      />

      <div className="sm:col-span-4">
        <div className="mb-1 flex items-baseline justify-between text-xs text-slate-500">
          <span>Current cycle vs recent average</span>
          {pct != null && <span className="tabular">{pct.toFixed(0)}%</span>}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-sky-500/15">
          <div
            className="h-full rounded-full bg-sky-500 transition-all"
            style={{ width: pct != null ? `${pct}%` : '0%' }}
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-600">
          {avg == null
            ? 'Cycle length is timed between successive greens of the same phase, so it appears after one full cycle.'
            : 'Actuated operation: cycle length varies with demand, so this compares against the recent average rather than a fixed cycle.'}
        </p>
      </div>
    </div>
  )
}

function Item(props: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-xs text-slate-500">{props.label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">
        {props.value}
      </div>
      {props.hint && (
        <div className="text-[10px] text-slate-600">{props.hint}</div>
      )}
    </div>
  )
}
