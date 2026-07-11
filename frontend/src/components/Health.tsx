import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { StreamState } from '../lib/stream'
import type { Connection } from '../types'
import { Card, CardHeader, ConnectionBadge } from './ui'

/* Chart palette: categorical slot 1 (blue) on the dark slate surface.
   Validated with the dataviz validator: lightness band, chroma floor, CVD
   separation, and contrast all pass against surface #0f172a. */
const SERIES = '#3987e5'
const STATUS: Record<Connection, string> = {
  connected: '#0ca30c',
  degraded: '#fab219',
  disconnected: '#d03b3b',
}

function StatTile(props: {
  label: string
  value: string
  unit?: string
  hint?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-xs text-slate-500">{props.label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-slate-100">
          {props.value}
        </span>
        {props.unit && (
          <span className="text-sm text-slate-500">{props.unit}</span>
        )}
      </div>
      {props.hint && <div className="mt-0.5 text-xs text-slate-500">{props.hint}</div>}
    </div>
  )
}

/* 2px line, no fill, recessive. One series, so no legend box: the tile
   label names it. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-10 text-xs text-slate-600">collecting...</div>
  }
  const w = 240
  const h = 40
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = w / (values.length - 1)
  const points = values
    .map((v, i) => `${i * step},${h - ((v - min) / span) * (h - 6) - 3}`)
    .join(' ')
  const last = values[values.length - 1]
  const lastY = h - ((last - min) / span) * (h - 6) - 3
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={SERIES}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={w} cy={lastY} r={3.5} fill={SERIES} stroke="#0f172a" strokeWidth={2} />
    </svg>
  )
}

function uptimeText(ticks?: number) {
  if (ticks == null) return '--'
  const s = Math.floor(ticks / 100)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`
}

export function Health({ stream }: { stream: StreamState }) {
  return (
    <div className="space-y-4">
      {stream.intersections.map((ix) => {
        const snap = stream.snapshots[ix.id]
        const history = stream.latencyHistory[ix.id] ?? []
        const avg =
          history.length > 0
            ? history.reduce((a, b) => a + b, 0) / history.length
            : null
        const worst = history.length > 0 ? Math.max(...history) : null
        return (
          <Card key={ix.id}>
            <CardHeader>
              <h2 className="font-semibold text-slate-100">{ix.name}</h2>
              <ConnectionBadge state={ix.connection} />
            </CardHeader>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Poll latency"
                value={snap ? snap.poll_latency_ms.toFixed(0) : '--'}
                unit="ms"
                hint={
                  avg != null && worst != null
                    ? `avg ${avg.toFixed(0)} · peak ${worst.toFixed(0)}`
                    : undefined
                }
              />
              <StatTile
                label="Controller uptime"
                value={uptimeText(snap?.uptime_ticks)}
                hint={ix.static?.sys_descr?.split(' ').slice(0, 3).join(' ')}
              />
              <StatTile
                label="Polls received"
                value={snap ? snap.seq.toLocaleString() : '0'}
                hint={`${ix.static?.polled_phases ?? 0} phases · ${
                  ix.static?.controller_max_phases ?? '?'
                } available`}
              />
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Link state</span>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS[ix.connection] }}
                  />
                </div>
                <div
                  className={clsx(
                    'mt-1 text-2xl font-semibold capitalize',
                    ix.connection === 'connected' && 'text-emerald-400',
                    ix.connection === 'degraded' && 'text-amber-400',
                    ix.connection === 'disconnected' && 'text-red-400',
                  )}
                >
                  {ix.connection}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">SNMP v1 · {ix.id}</div>
              </div>
            </div>
            <div className="border-t border-slate-800 px-4 py-3">
              <div className="mb-1 text-xs text-slate-500">
                Poll latency, last {history.length} polls (ms)
              </div>
              <Sparkline values={history} />
            </div>
          </Card>
        )
      })}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-100">Event log</h2>
          <span className="text-xs text-slate-500">{stream.events.length} events</span>
        </CardHeader>
        <div className="max-h-72 overflow-y-auto">
          {stream.events.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              No events yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {[...stream.events].reverse().map((e, i) => (
                  <tr key={i} className="border-b border-slate-800/60 last:border-0">
                    <td className="tabular w-40 px-4 py-1.5 text-xs text-slate-500">
                      {e.ts.slice(11, 23)}
                    </td>
                    <td className="w-32 py-1.5">
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5 text-xs font-medium',
                          e.kind === 'disconnected' && 'bg-red-500/15 text-red-400',
                          e.kind === 'degraded' && 'bg-amber-500/15 text-amber-400',
                          (e.kind === 'connected' || e.kind === 'reconnected') &&
                            'bg-emerald-500/15 text-emerald-400',
                          e.kind === 'controller-reboot' &&
                            'bg-violet-500/15 text-violet-400',
                        )}
                      >
                        {e.kind}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-slate-400">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  )
}
