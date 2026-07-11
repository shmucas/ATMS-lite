import clsx from 'clsx'
import { useState } from 'react'
import { control } from '../lib/control'
import type { ControlState } from '../lib/stream'
import type { IntersectionInfo, Snapshot } from '../types'
import { CoordMonitor } from './CoordMonitor'
import { RingDiagram } from './RingDiagram'
import { Card, CardHeader, ConnectionBadge } from './ui'

function uptimeText(ticks?: number) {
  if (ticks == null) return '--'
  const s = Math.floor(ticks / 100)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export function IntersectionCard(props: {
  info: IntersectionInfo
  snapshot?: Snapshot
  control?: ControlState
}) {
  const { info, snapshot } = props
  const armed = props.control?.armed ?? false
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onPhaseClick =
    armed && info.connection !== 'disconnected'
      ? (phase: number) => run(() => control.call(info.id, 'veh', phase, true))
      : undefined

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline gap-3">
          <h2 className="font-semibold text-slate-100">{info.name}</h2>
          <span className="text-xs text-slate-500">
            {info.static?.sys_descr}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {armed && (
            <span className="hidden text-xs text-amber-400 sm:inline">
              click a phase to place a call
            </span>
          )}
          <button
            type="button"
            disabled={busy || info.connection === 'disconnected'}
            onClick={() =>
              run(() => (armed ? control.disarm(info.id) : control.arm(info.id)))
            }
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-40',
              armed
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'border border-slate-700 text-slate-300 hover:bg-slate-800',
            )}
          >
            {armed ? 'Armed · disarm' : 'Arm control'}
          </button>
          <ConnectionBadge state={info.connection} />
        </div>
      </CardHeader>

      {armed && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
          Control armed. Vehicle calls you place are written to the physical
          controller and auto-clear on disarm or disconnect.
        </div>
      )}
      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-4 px-4 py-4">
        {snapshot ? (
          <>
            <RingDiagram
              snapshot={snapshot}
              info={info}
              onPhaseClick={onPhaseClick}
              armed={armed}
            />
            <CoordMonitor snapshot={snapshot} />
            <div className="tabular flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>seq {snapshot.seq}</span>
              <span>poll {snapshot.poll_latency_ms} ms</span>
              <span>uptime {uptimeText(snapshot.uptime_ticks)}</span>
              <span>
                {info.static?.polled_phases ?? 8} of{' '}
                {info.static?.controller_max_phases ?? '?'} phases polled
              </span>
              <span>{snapshot.ts}</span>
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-sm text-slate-500">
            No data yet from this controller.
          </div>
        )}
      </div>
    </Card>
  )
}
