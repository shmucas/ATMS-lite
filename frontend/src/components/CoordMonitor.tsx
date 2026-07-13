import type { Snapshot } from '../types'

export function CoordMonitor({ snapshot }: { snapshot: Snapshot }) {
  const coord = snapshot.coord
  if (!coord) return null

  const elapsed = coord.cycle_elapsed
  const total = coord.last_cycle
  /* Actuated operation: the cycle is not fixed, so show the running clock
     against the last observed cycle length rather than a fixed target. */
  const current =
    elapsed != null && total != null
      ? `${elapsed.toFixed(0)}/${total.toFixed(0)}`
      : elapsed != null
        ? `${elapsed.toFixed(0)}s`
        : '--'

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        Coordination
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <Item label="Pattern" value={coord.pattern ?? '--'} />
        <Item label="Current cycle" value={current} />
        <Item
          label="Avg cycle"
          value={coord.avg_cycle != null ? `${coord.avg_cycle.toFixed(0)}s` : '--'}
          hint={
            coord.cycles_seen > 0
              ? `${coord.cycles_seen} cycle${coord.cycles_seen === 1 ? '' : 's'} measured`
              : 'measuring...'
          }
        />
        <Item
          label="Sync timer"
          value={coord.sync_timer != null ? `${coord.sync_timer}s` : '--'}
        />
        {/* Raw NTCIP value, shown as the controller states it. */}
        <Item label="Local free" value={coord.local_free ?? '--'} />
        <Item
          label="Reference"
          value={coord.reference_phase != null ? `Φ${coord.reference_phase}` : '--'}
          hint="cycle timed on this phase"
        />
      </div>
    </section>
  )
}

function Item(props: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-ink-3)]">{props.label}</div>
      <div className="tabular mt-0.5 text-base font-semibold text-[var(--color-ink)]">
        {props.value}
      </div>
      {props.hint && (
        <div className="text-[10px] text-[var(--color-ink-3)]">{props.hint}</div>
      )}
    </div>
  )
}
