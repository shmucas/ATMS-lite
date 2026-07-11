import type { Snapshot } from '../../types'

const BAR = 'var(--color-accent)'

export function DetectorPanel({ snapshot }: { snapshot?: Snapshot }) {
  if (!snapshot) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
        No data yet.
      </div>
    )
  }
  const moe = snapshot.moe?.phases.filter((p) => p.phase <= 8) ?? []
  const dets = snapshot.detectors ?? []
  const anyReporting = dets.some((d) => d.reporting)

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Green utilization
        </h3>
        {moe.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-3)]">Measuring...</p>
        ) : (
          <div className="space-y-2">
            {moe.map((p) => (
              <div key={p.phase} className="flex items-center gap-3">
                <span className="w-8 shrink-0 text-xs text-[var(--color-ink-2)]">
                  {'Φ'}
                  {p.phase}
                </span>
                <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-[var(--color-accent)]/10">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${p.green_pct}%`,
                      background: BAR,
                      minWidth: p.green_pct > 0 ? 3 : 0,
                    }}
                  />
                </div>
                <span className="tabular w-12 shrink-0 text-right text-xs text-[var(--color-ink-2)]">
                  {p.green_pct.toFixed(0)}%
                </span>
              </div>
            ))}
            <p className="pt-1 text-[10px] text-[var(--color-ink-3)]">
              Share of the last {snapshot.moe?.window_polls} polls each phase was
              green. Computed from the signal stream, so it needs no detectors.
            </p>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Detectors
        </h3>
        {!anyReporting && (
          <div className="mb-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-ink-3)]">
            No detectors are reporting occupancy. Expected on a bench unit with
            no field detectors wired in.
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-[var(--color-ink-3)]">
              <th className="pb-1 font-medium">Det</th>
              <th className="pb-1 font-medium">Volume</th>
              <th className="pb-1 font-medium">Occ</th>
              <th className="pb-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {dets.map((d) => (
              <tr key={d.detector} className="border-t border-[var(--color-line)]">
                <td className="tabular py-1.5 text-[var(--color-ink-2)]">
                  {d.detector}
                </td>
                <td className="tabular py-1.5 text-[var(--color-ink-2)]">
                  {d.volume ?? '--'}
                </td>
                <td className="tabular py-1.5 text-[var(--color-ink-2)]">
                  {d.occupancy != null ? `${d.occupancy}%` : '--'}
                </td>
                <td className="py-1.5">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px]"
                    style={
                      d.reporting
                        ? { background: 'color-mix(in srgb, var(--color-online) 15%, transparent)', color: 'var(--color-online)' }
                        : { background: 'var(--color-panel-2)', color: 'var(--color-ink-3)' }
                    }
                  >
                    {d.reporting ? 'reporting' : 'no data'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
