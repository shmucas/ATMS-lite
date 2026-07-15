import { useEffect, useMemo, useState } from 'react'
import { intersectionsApi, type HiresEvent } from '../lib/intersections'
import { SIGNAL_FILL } from '../lib/phaseColors'
import {
  computeSplits,
  phasesWithSplits,
  summarize,
  type PhaseSplit,
} from '../lib/splitMonitor'
import {
  computeCycles,
  detectorChannels,
  type PcdCycle,
} from '../lib/purdueCoordination'
import type { StreamState } from '../lib/stream'

const REFRESH_MS = 5000
const MARGIN = { top: 16, right: 20, bottom: 30, left: 40 }
const PLOT_HEIGHT = 240
const BAR_SLOT = 30 // px of horizontal room per cycle
const BAR_WIDTH = 16
const MAX_RANGE_MINUTES = 60

/* `datetime-local` inputs want and return local wall-clock time with no
   timezone, so Date's own ISO formatter (always UTC) can't round-trip it. */
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmt(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : '-'
}

function Tile(props: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">
        {props.label}
      </div>
      <div className="text-lg font-semibold tabular text-[var(--color-ink)]">
        {props.value}
        {props.unit && (
          <span className="ml-1 text-xs font-normal text-[var(--color-ink-3)]">{props.unit}</span>
        )}
      </div>
    </div>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-2)]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function SplitChart({ phase, splits }: { phase: number; splits: PhaseSplit[] }) {
  const [hover, setHover] = useState<number | null>(null)

  const cycleVals = splits.map((s) => s.cycle).filter((c): c is number => c != null)
  const yMax = Math.max(
    10,
    ...splits.map((s) => s.green + s.yellow),
    ...cycleVals,
  )
  const yTop = Math.ceil((yMax * 1.1) / 10) * 10

  const plotWidth = Math.max(splits.length * BAR_SLOT, 560)
  const width = plotWidth + MARGIN.left + MARGIN.right
  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom

  const xOf = (i: number) => MARGIN.left + i * BAR_SLOT + BAR_SLOT / 2
  const yOf = (s: number) => MARGIN.top + PLOT_HEIGHT - (s / yTop) * PLOT_HEIGHT

  const yTicks = Array.from({ length: 5 }, (_, i) => (yTop / 4) * i)

  // Cycle-length polyline over the activations that have a measured cycle.
  const cyclePts = splits
    .map((s, i) => (s.cycle != null ? `${xOf(i)},${yOf(s.cycle)}` : null))
    .filter((p): p is string => p != null)
    .join(' ')

  return (
    <div className="relative">
      <div className="scroll-thin overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-2">
        <svg width={width} height={height}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={MARGIN.left}
                y1={yOf(v)}
                x2={MARGIN.left + plotWidth}
                y2={yOf(v)}
                stroke="var(--color-line)"
              />
              <text
                x={MARGIN.left - 6}
                y={yOf(v) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-ink-3)"
              >
                {v}
              </text>
            </g>
          ))}

          {splits.map((s, i) => {
            const x = xOf(i) - BAR_WIDTH / 2
            const gTop = yOf(s.green)
            const gBottom = yOf(0)
            const yTopPx = yOf(s.green + s.yellow)
            const active = hover === i
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                {/* Yellow clearance, stacked on top with a 2px surface gap. */}
                {s.yellow > 0 && (
                  <rect
                    x={x}
                    y={yTopPx}
                    width={BAR_WIDTH}
                    height={Math.max(gTop - yTopPx - 2, 0)}
                    rx={3}
                    fill={SIGNAL_FILL.yellow}
                    opacity={active ? 1 : 0.9}
                  />
                )}
                {/* Green, anchored to the baseline. */}
                <rect
                  x={x}
                  y={gTop}
                  width={BAR_WIDTH}
                  height={Math.max(gBottom - gTop, 0)}
                  rx={3}
                  fill={SIGNAL_FILL.green}
                  opacity={active ? 1 : 0.9}
                />
                {/* Invisible full-height hit target for easy hover. */}
                <rect
                  x={xOf(i) - BAR_SLOT / 2}
                  y={MARGIN.top}
                  width={BAR_SLOT}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
              </g>
            )
          })}

          {/* Cycle length trace, one shared seconds axis with the splits. */}
          <polyline
            points={cyclePts}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
          />
          {splits.map((s, i) =>
            s.cycle != null ? (
              <circle
                key={i}
                cx={xOf(i)}
                cy={yOf(s.cycle)}
                r={hover === i ? 4 : 2.5}
                fill="var(--color-accent)"
                stroke="var(--color-panel-2)"
                strokeWidth={1.5}
              />
            ) : null,
          )}
        </svg>
      </div>

      {hover != null && splits[hover] && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] shadow-lg">
          <div className="mb-0.5 font-semibold text-[var(--color-ink)]">
            {new Date(splits[hover].greenStart).toLocaleTimeString([], {
              hour12: false,
            })}
          </div>
          <div className="tabular text-[var(--color-ink-2)]">
            Green {fmt(splits[hover].green)}s · Yellow {fmt(splits[hover].yellow)}s
          </div>
          <div className="tabular text-[var(--color-ink-3)]">
            Cycle {splits[hover].cycle != null ? `${fmt(splits[hover].cycle)}s` : '-'}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 px-1">
        <LegendKey color={SIGNAL_FILL.green} label="Green" />
        <LegendKey color={SIGNAL_FILL.yellow} label="Yellow" />
        <LegendKey color="var(--color-accent)" label="Cycle length" />
        <span className="ml-auto text-[10px] text-[var(--color-ink-3)]">
          Phase {phase} · seconds
        </span>
      </div>
    </div>
  )
}

function SplitMonitor(props: { id: string; start: string; end: string; minutes: number }) {
  const { id, start, end, minutes } = props
  const [events, setEvents] = useState<HiresEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const rows = await intersectionsApi.hires(id, {
          start,
          end,
          limit: Math.min(10000, minutes * 200),
        })
        if (stopped) return
        setEvents(rows)
        setError(null)
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [id, start, end, minutes])

  const phases = useMemo(() => (events ? phasesWithSplits(events) : []), [events])

  // Keep a valid phase selected as data comes and goes.
  useEffect(() => {
    if (phases.length === 0) {
      if (phase !== null) setPhase(null)
    } else if (phase == null || !phases.includes(phase)) {
      setPhase(phases[0])
    }
  }, [phases, phase])

  const series = useMemo(
    () =>
      events && phase != null ? summarize(phase, computeSplits(events, phase)) : null,
    [events, phase],
  )

  if (error) {
    return (
      <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-sm text-[var(--color-offline)]">
        {error.includes('ATMS_DB_DSN')
          ? 'Hi-res capture is not enabled. Set ATMS_DB_DSN to record events for reports.'
          : error}
      </div>
    )
  }

  if (events == null) {
    return <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">Loading...</div>
  }

  if (phases.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">
        No complete phase splits in the last {minutes} min yet. Splits appear once a phase
        has run a full green-to-yellow cycle.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--color-ink-3)]">Phase</span>
        {phases.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPhase(p)}
            className={
              phase === p
                ? 'rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]'
                : 'rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]'
            }
          >
            {p}
          </button>
        ))}
      </div>

      {series && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Avg green" value={fmt(series.avgGreen)} unit="s" />
            <Tile
              label="Green range"
              value={`${fmt(series.minGreen)}-${fmt(series.maxGreen)}`}
              unit="s"
            />
            <Tile
              label="Avg cycle"
              value={series.avgCycle != null ? fmt(series.avgCycle) : '-'}
              unit="s"
            />
            <Tile label="Cycles" value={String(series.splits.length)} />
          </div>
          <SplitChart phase={series.phase} splits={series.splits} />
        </>
      )}
    </div>
  )
}

function PcdChart({
  phase,
  channel,
  cycles,
}: {
  phase: number
  channel: number
  cycles: PcdCycle[]
}) {
  const [hover, setHover] = useState<number | null>(null)

  const yMax = Math.max(10, ...cycles.map((c) => c.length))
  const yTop = Math.ceil((yMax * 1.1) / 10) * 10

  const plotWidth = Math.max(cycles.length * BAR_SLOT, 560)
  const width = plotWidth + MARGIN.left + MARGIN.right
  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom

  const xOf = (i: number) => MARGIN.left + i * BAR_SLOT + BAR_SLOT / 2
  // Offset 0 (the cycle's green onset) at the top, growing downward -
  // reads top-to-bottom as "time since the phase turned green."
  const yOf = (offsetS: number) => MARGIN.top + (offsetS / yTop) * PLOT_HEIGHT

  const yTicks = Array.from({ length: 5 }, (_, i) => (yTop / 4) * i)

  return (
    <div className="relative">
      <div className="scroll-thin overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-2">
        <svg width={width} height={height}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={MARGIN.left}
                y1={yOf(v)}
                x2={MARGIN.left + plotWidth}
                y2={yOf(v)}
                stroke="var(--color-line)"
              />
              <text
                x={MARGIN.left - 6}
                y={yOf(v) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-ink-3)"
              >
                {v}
              </text>
            </g>
          ))}

          {cycles.map((c, i) => {
            const x = xOf(i) - BAR_WIDTH / 2
            const active = hover === i
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                {/* Green/yellow/red band, chronological top-to-bottom. */}
                {c.bands.map((b, bi) => (
                  <rect
                    key={bi}
                    x={x}
                    y={yOf((b.start - c.cycleStart) / 1000)}
                    width={BAR_WIDTH}
                    height={Math.max(
                      yOf((b.end - c.cycleStart) / 1000) - yOf((b.start - c.cycleStart) / 1000),
                      0,
                    )}
                    fill={SIGNAL_FILL[b.signal]}
                    opacity={active ? 1 : 0.85}
                  />
                ))}
                {/* Detector arrivals, ticked at their offset into the cycle. */}
                {c.actuations.map((a, ai) => (
                  <circle
                    key={ai}
                    cx={xOf(i)}
                    cy={yOf(a.offset)}
                    r={active ? 3.5 : 2.5}
                    fill="var(--color-panel)"
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                  />
                ))}
                {/* Invisible full-height hit target for easy hover. */}
                <rect
                  x={xOf(i) - BAR_SLOT / 2}
                  y={MARGIN.top}
                  width={BAR_SLOT}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
              </g>
            )
          })}
        </svg>
      </div>

      {hover != null && cycles[hover] && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] shadow-lg">
          <div className="mb-0.5 font-semibold text-[var(--color-ink)]">
            {new Date(cycles[hover].cycleStart).toLocaleTimeString([], { hour12: false })}
          </div>
          <div className="tabular text-[var(--color-ink-2)]">
            Cycle {fmt(cycles[hover].length)}s · {cycles[hover].actuations.length} arrival
            {cycles[hover].actuations.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 px-1">
        <LegendKey color={SIGNAL_FILL.green} label="Green" />
        <LegendKey color={SIGNAL_FILL.yellow} label="Yellow" />
        <LegendKey color={SIGNAL_FILL.red} label="Red" />
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-2)]">
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--color-accent)] bg-[var(--color-panel)]" />
          Detector arrival
        </span>
        <span className="ml-auto text-[10px] text-[var(--color-ink-3)]">
          Phase {phase} · detector {channel} · seconds into cycle
        </span>
      </div>
    </div>
  )
}

function PurdueCoordination(props: { id: string; start: string; end: string; minutes: number }) {
  const { id, start, end, minutes } = props
  const [events, setEvents] = useState<HiresEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<number | null>(null)
  const [channel, setChannel] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const rows = await intersectionsApi.hires(id, {
          start,
          end,
          limit: Math.min(10000, minutes * 200),
        })
        if (stopped) return
        setEvents(rows)
        setError(null)
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [id, start, end, minutes])

  const phases = useMemo(() => (events ? phasesWithSplits(events) : []), [events])
  const channels = useMemo(() => (events ? detectorChannels(events) : []), [events])

  useEffect(() => {
    if (phases.length === 0) {
      if (phase !== null) setPhase(null)
    } else if (phase == null || !phases.includes(phase)) {
      setPhase(phases[0])
    }
  }, [phases, phase])

  useEffect(() => {
    if (channels.length === 0) {
      if (channel !== null) setChannel(null)
    } else if (channel == null || !channels.includes(channel)) {
      setChannel(channels[0])
    }
  }, [channels, channel])

  const cycles = useMemo(() => {
    if (!events || phase == null || channel == null) return []
    return computeCycles(
      events,
      phase,
      channel,
      new Date(start).getTime(),
      new Date(end).getTime(),
    )
  }, [events, phase, channel, start, end])

  if (error) {
    return (
      <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-sm text-[var(--color-offline)]">
        {error.includes('ATMS_DB_DSN')
          ? 'Hi-res capture is not enabled. Set ATMS_DB_DSN to record events for reports.'
          : error}
      </div>
    )
  }

  if (events == null) {
    return <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">Loading...</div>
  }

  if (phases.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">
        No complete phase cycles in the last {minutes} min yet. Cycles appear once a phase
        has run a full green-to-green cycle.
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">
        No detector activity in the last {minutes} min yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--color-ink-3)]">Phase</span>
        {phases.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPhase(p)}
            className={
              phase === p
                ? 'rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]'
                : 'rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]'
            }
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--color-ink-3)]">Detector</span>
        {channels.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={
              channel === c
                ? 'rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]'
                : 'rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]'
            }
          >
            {c}
          </button>
        ))}
      </div>

      {phase != null && channel != null && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Cycles" value={String(cycles.length)} />
            <Tile
              label="Total arrivals"
              value={String(cycles.reduce((n, c) => n + c.actuations.length, 0))}
            />
          </div>
          <PcdChart phase={phase} channel={channel} cycles={cycles} />
        </>
      )}
    </div>
  )
}

type ReportType = 'split' | 'pcd'

const REPORT_LABEL: Record<ReportType, string> = {
  split: 'Split Monitor',
  pcd: 'Purdue Coordination Diagram',
}

export function AtspmReports(props: { stream: StreamState; onClose: () => void }) {
  const { stream, onClose } = props
  const ix = stream.intersections
  const [report, setReport] = useState<ReportType>('split')
  const [id, setId] = useState<string | null>(null)
  const [start, setStart] = useState(() =>
    toLocalInputValue(new Date(Date.now() - 30 * 60_000)),
  )
  const [end, setEnd] = useState(() => toLocalInputValue(new Date()))

  const startDate = new Date(start)
  const endDate = new Date(end)
  const rangeInvalid = !(endDate.getTime() > startDate.getTime())
  const minutes = rangeInvalid
    ? 0
    : Math.round((endDate.getTime() - startDate.getTime()) / 60_000)
  const rangeTooLong = minutes > MAX_RANGE_MINUTES

  const onStartChange = (value: string) => {
    setStart(value)
    const s = new Date(value)
    if (endDate.getTime() - s.getTime() > MAX_RANGE_MINUTES * 60_000) {
      setEnd(toLocalInputValue(new Date(s.getTime() + MAX_RANGE_MINUTES * 60_000)))
    }
  }

  const onEndChange = (value: string) => {
    setEnd(value)
    const e = new Date(value)
    if (e.getTime() - startDate.getTime() > MAX_RANGE_MINUTES * 60_000) {
      setStart(toLocalInputValue(new Date(e.getTime() - MAX_RANGE_MINUTES * 60_000)))
    }
  }

  // Default to the first reachable intersection; keep the selection valid.
  useEffect(() => {
    if (ix.length === 0) {
      if (id !== null) setId(null)
      return
    }
    if (id == null || !ix.some((i) => i.id === id)) {
      const online = ix.find((i) => i.connection === 'connected' || i.connection === 'degraded')
      setId((online ?? ix[0]).id)
    }
  }, [ix, id])

  return (
    <div className="flex h-full w-full flex-col border-t border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-bold text-[var(--color-ink)]">ATSPM Reports</h2>
          <span className="text-xs text-[var(--color-ink-3)]">{REPORT_LABEL[report]}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Report
          <select
            value={report}
            onChange={(e) => setReport(e.target.value as ReportType)}
            className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          >
            <option value="split">Split Monitor</option>
            <option value="pcd">Purdue Coordination Diagram</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Intersection
          <select
            value={id ?? ''}
            onChange={(e) => setId(e.target.value || null)}
            className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          >
            {ix.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          From
          <input
            type="datetime-local"
            value={start}
            max={end}
            onChange={(e) => onStartChange(e.target.value)}
            className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          To
          <input
            type="datetime-local"
            value={end}
            min={start}
            onChange={(e) => onEndChange(e.target.value)}
            className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
        </label>
        <span className="text-[10px] text-[var(--color-ink-3)]">
          Up to {MAX_RANGE_MINUTES} min per report
        </span>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {id == null ? (
          <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
            No intersections available.
          </div>
        ) : rangeInvalid ? (
          <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
            Pick an end time after the start time.
          </div>
        ) : rangeTooLong ? (
          <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
            Range can't exceed {MAX_RANGE_MINUTES} minutes.
          </div>
        ) : report === 'split' ? (
          <SplitMonitor
            id={id}
            start={startDate.toISOString()}
            end={endDate.toISOString()}
            minutes={minutes}
          />
        ) : (
          <PurdueCoordination
            id={id}
            start={startDate.toISOString()}
            end={endDate.toISOString()}
            minutes={minutes}
          />
        )}
      </div>
    </div>
  )
}
