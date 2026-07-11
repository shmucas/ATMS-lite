import clsx from 'clsx'
import type { StreamState } from '../../lib/stream'
import type { IntersectionInfo, Snapshot } from '../../types'

const SERIES = 'var(--color-accent)'

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-10 text-xs text-[var(--color-ink-3)]">collecting...</div>
  }
  const w = 400
  const h = 40
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = w / (values.length - 1)
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / span) * (h - 6) - 3}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={SERIES}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
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

function Tile(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--color-ink-3)]">{props.label}</div>
      <div className="mt-0.5 text-xl font-semibold text-[var(--color-ink)]">
        {props.value}
      </div>
      {props.hint && (
        <div className="text-[10px] text-[var(--color-ink-3)]">{props.hint}</div>
      )}
    </div>
  )
}

export function HealthPanel(props: {
  info: IntersectionInfo
  snapshot?: Snapshot
  stream: StreamState
}) {
  const { info, snapshot, stream } = props
  const history = stream.latencyHistory[info.id] ?? []
  const avg =
    history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : null
  const worst = history.length > 0 ? Math.max(...history) : null
  const events = stream.events.filter((e) => e.intersection_id === info.id)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label="Poll latency"
          value={snapshot ? `${snapshot.poll_latency_ms.toFixed(0)} ms` : '--'}
          hint={
            avg != null && worst != null
              ? `avg ${avg.toFixed(0)} · peak ${worst.toFixed(0)}`
              : undefined
          }
        />
        <Tile label="Uptime" value={uptimeText(snapshot?.uptime_ticks)} />
        <Tile label="Polls" value={snapshot ? snapshot.seq.toLocaleString() : '0'} />
        <Tile
          label="Protocol"
          value="SNMP v1"
          hint={`${info.static?.polled_phases ?? 0} phases`}
        />
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Poll latency · last {history.length}
        </h3>
        <Sparkline values={history} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Events
        </h3>
        {events.length === 0 ? (
          <div className="py-4 text-center text-sm text-[var(--color-ink-3)]">
            No events yet.
          </div>
        ) : (
          <div className="space-y-1">
            {[...events].reverse().slice(0, 30).map((e, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-[var(--color-line)] py-1.5 text-xs last:border-0"
              >
                <span className="tabular w-20 shrink-0 text-[var(--color-ink-3)]">
                  {e.ts.slice(11, 19)}
                </span>
                <span
                  className={clsx(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  )}
                  style={
                    e.kind === 'disconnected'
                      ? { background: 'color-mix(in srgb, var(--color-offline) 15%, transparent)', color: 'var(--color-offline)' }
                      : e.kind === 'degraded'
                        ? { background: 'color-mix(in srgb, var(--color-degraded) 15%, transparent)', color: 'var(--color-degraded)' }
                        : e.kind === 'connected' || e.kind === 'reconnected'
                          ? { background: 'color-mix(in srgb, var(--color-online) 15%, transparent)', color: 'var(--color-online)' }
                          : { background: 'var(--color-panel-2)', color: 'var(--color-ink-2)' }
                  }
                >
                  {e.kind}
                </span>
                <span className="text-[var(--color-ink-2)]">{e.detail}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
