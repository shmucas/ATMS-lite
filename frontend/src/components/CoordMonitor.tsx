import type { Snapshot } from '../types'

export function CoordMonitor({ snapshot }: { snapshot: Snapshot }) {
  const coord = snapshot.coord
  if (!coord) return null

  const elapsed = coord.cycle_elapsed
  const avg = coord.avg_cycle
  /* Actuated operation: the cycle is not fixed. Show the running cycle against
     the recent average and say so, rather than implying a fixed cycle. */
  const pct =
    elapsed != null && avg != null && avg > 0
      ? Math.min(100, (elapsed / avg) * 100)
      : null

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        Coordination
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <Item label="Pattern" value={coord.pattern ?? '--'} />
        <Item
          label="Avg cycle"
          value={avg != null ? `${avg.toFixed(0)}s` : '--'}
          hint={coord.cycles_seen ? `over ${coord.cycles_seen}` : undefined}
        />
        <Item
          label="Last cycle"
          value={coord.last_cycle != null ? `${coord.last_cycle.toFixed(0)}s` : '--'}
        />
        <Item
          label="Into cycle"
          value={elapsed != null ? `${elapsed.toFixed(0)}s` : '--'}
        />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-[var(--color-ink-3)]">
          <span>Cycle vs recent average</span>
          {pct != null && <span className="tabular">{pct.toFixed(0)}%</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-accent)]/15">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: pct != null ? `${pct}%` : '0%' }}
          />
        </div>
        <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
          {avg == null
            ? 'Cycle length is timed between successive greens of a phase; it appears after one full cycle.'
            : 'Actuated: cycle varies with demand, so this compares to the recent average.'}
        </p>
      </div>
    </section>
  )
}

function Item(props: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-ink-3)]">{props.label}</div>
      <div className="mt-0.5 text-base font-semibold text-[var(--color-ink)]">
        {props.value}
      </div>
      {props.hint && (
        <div className="text-[10px] text-[var(--color-ink-3)]">{props.hint}</div>
      )}
    </div>
  )
}
