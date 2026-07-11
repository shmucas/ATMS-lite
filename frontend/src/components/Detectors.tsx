import type { StreamState } from '../lib/stream'
import type { Snapshot } from '../types'
import { Card, CardHeader } from './ui'

/* Single-series magnitude, so one sequential hue (blue), light on the track,
   solid on the fill. No legend box: the panel title names what is plotted. */
const BAR = '#3987e5'

function MoeChart({ snapshot }: { snapshot: Snapshot }) {
  const moe = snapshot.moe
  if (!moe || moe.phases.length === 0) {
    return <div className="text-sm text-slate-500">No MOE data yet.</div>
  }
  const active = moe.phases.filter((p) => p.phase <= 8)
  return (
    <div className="space-y-2">
      {active.map((p) => (
        <div key={p.phase} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-xs text-slate-400">
            {'Φ'}
            {p.phase}
          </span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-sky-500/10">
            <div
              className="h-full rounded"
              style={{ width: `${p.green_pct}%`, background: BAR, minWidth: p.green_pct > 0 ? 4 : 0 }}
            />
          </div>
          <span className="tabular w-14 shrink-0 text-right text-xs text-slate-300">
            {p.green_pct.toFixed(0)}%
          </span>
        </div>
      ))}
      <p className="pt-1 text-[10px] text-slate-600">
        Green utilization = fraction of the last {moe.window_polls} polls each
        phase showed green. Computed from the signal stream, so it needs no
        detectors.
      </p>
    </div>
  )
}

function DetectorTable({ snapshot }: { snapshot: Snapshot }) {
  const dets = snapshot.detectors ?? []
  if (dets.length === 0) {
    return <div className="text-sm text-slate-500">No detector data yet.</div>
  }
  const anyReporting = dets.some((d) => d.reporting)
  return (
    <div className="space-y-2">
      {!anyReporting && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-500">
          No detectors are reporting occupancy on this controller. Volume reads
          zero and occupancy returns the NTCIP no-data value, which is expected
          on a bench unit with no field detectors wired in.
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Detector</th>
            <th className="py-1 font-medium">Volume</th>
            <th className="py-1 font-medium">Occupancy</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {dets.map((d) => (
            <tr key={d.detector} className="border-t border-slate-800/60">
              <td className="tabular py-1.5 text-slate-300">{d.detector}</td>
              <td className="tabular py-1.5 text-slate-300">{d.volume ?? '--'}</td>
              <td className="tabular py-1.5 text-slate-300">
                {d.occupancy != null ? `${d.occupancy}%` : '--'}
              </td>
              <td className="py-1.5">
                <span
                  className={
                    d.reporting
                      ? 'rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-400'
                      : 'rounded bg-slate-700/40 px-1.5 py-0.5 text-xs text-slate-500'
                  }
                >
                  {d.reporting ? 'reporting' : 'no data'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Detectors({ stream }: { stream: StreamState }) {
  return (
    <div className="space-y-4">
      {stream.intersections.map((ix) => {
        const snap = stream.snapshots[ix.id]
        if (!snap) return null
        return (
          <div key={ix.id} className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-slate-100">
                  {ix.name} · green utilization
                </h2>
              </CardHeader>
              <div className="px-4 py-4">
                <MoeChart snapshot={snap} />
              </div>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-slate-100">
                  {ix.name} · detectors
                </h2>
              </CardHeader>
              <div className="px-4 py-4">
                <DetectorTable snapshot={snap} />
              </div>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
